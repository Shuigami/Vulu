// Runs a library import in the worker: resolves each row to a catalogue media, then adds it
// to the user's library. Existing entries are kept as they are (V1 choice).
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { importMedia, searchProvider, upsertMedia, type Providers } from '../catalogue';
import type { Db } from '../db';
import { activityEvents, importJobs, libraryEntries, media, seasons } from '../db/schema';
import { mergeEntries } from '../franchises';
import { cached, DAY } from '../providers/cache';
import type { MediaType, ProviderMedia, SearchResult } from '../providers/types';
import { findAnime } from './anime';
import type { ImportItem, ImportedEntry, ImportSource, Unmatched } from './types';

/** Case, accents and punctuation aside ("Amélie" = "amelie", "Spider-Man" = "Spider Man"). */
const norm = (s: string) =>
	s
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
const mostRated = (list: SearchResult[]) =>
	list.reduce<SearchResult | undefined>(
		(best, r) => (!best || (r.votes ?? 0) > (best.votes ?? 0) ? r : best),
		undefined
	);

/**
 * Finds a work from an English title and a year (Letterboxd). Searches that year in English and
 * keeps results within a year (sources date films by festival or theatrical release), then takes
 * the most rated of: films of the same title, else shows of the same title (miniseries are on
 * Letterboxd), else films whose title starts with it ("Glass Onion: A Knives Out Mystery").
 * Relevance or an exact year alone pick obscure namesakes ("Black Box" 2021 is Boîte noire).
 * No match leaves the row unmatched rather than guessing.
 */
async function findByTitle(
	db: Db,
	providers: Providers,
	type: MediaType,
	title: string,
	year: number | null
): Promise<number | null> {
	const near = async (t: MediaType) =>
		(
			await searchProvider(db, providers, t, title, {
				year: year ?? undefined,
				english: true,
				keepAnime: true
			})
		).filter((r) => year === null || (r.year !== null && Math.abs(r.year - year) <= 1));
	const q = norm(title);
	const same = (r: SearchResult) => [r.title, r.originalTitle].some((t) => t && norm(t) === q);
	const works = await near(type);
	let hit = mostRated(works.filter(same));
	if (!hit && type === 'movie') hit = mostRated((await near('tv')).filter(same));
	hit ??= mostRated(works.filter((r) => norm(r.title).startsWith(`${q} `)));
	if (!hit) return null;
	// Japanese animation: imported from AniList, which owns anime (unmatched if not there); a show
	// becomes its first season, the source giving no episode count to spread
	if (hit.anime && providers.anilist) {
		const titles = [title, hit.originalTitle];
		const found = await findAnime(db, providers.anilist, titles, year, hit.type === 'movie');
		return found ? (await animeWork(db, providers, found[0])).mediaId : null;
	}
	return importMedia(db, providers, hit.type, hit.externalId);
}

type Resolved = { mediaId: number; season?: number };

/**
 * An AniList anime as Vulu stores it: a series season is a season of its franchise
 * (docs/franchises-anime.md), fetched from AniList only when the franchise is not known yet.
 * Films, OVAs and series outside a chain are works of their own.
 */
async function animeWork(db: Db, providers: Providers, data: ProviderMedia): Promise<Resolved> {
	const id = data.externalIds.find((e) => e.provider === 'anilist')?.externalId;
	const series = ['TV', 'TV_SHORT', 'ONA'].includes(String(data.media.extra?.format));
	if (!id || !series) return { mediaId: await upsertMedia(db, data) };
	const season = async () =>
		(
			await db
				.select({ mediaId: seasons.mediaId, number: seasons.number })
				.from(seasons)
				.where(eq(seasons.anilistId, id))
				.limit(1)
		)[0];
	let found = await season();
	if (!found && (await importMedia(db, providers, 'anime', id))) found = await season();
	return found
		? { mediaId: found.mediaId, season: found.number }
		: { mediaId: await upsertMedia(db, data) };
}

/** One entry for a franchise from the user's entries of some of its seasons (mergeEntries). */
async function franchiseEntry(
	db: Db,
	mediaId: number,
	parts: { season: number; entry: ImportedEntry }[]
): Promise<ImportedEntry> {
	const list = await db
		.select({ number: seasons.number, count: seasons.episodeCount, status: seasons.status })
		.from(seasons)
		.where(and(eq(seasons.mediaId, mediaId), isNotNull(seasons.anilistId)))
		.orderBy(asc(seasons.number));
	// Episodes may not be synced yet: AniList's counts place each season
	const starts = new Map<number, number>();
	const seasonEnds: number[] = [];
	let end = 0;
	for (const s of list) {
		starts.set(s.number, end);
		end += s.count ?? 0;
		seasonEnds.push(end);
	}
	const counted = list.every((s) => s.count !== null);
	// While a season airs, how many episodes aired is unknown: nothing gets completed
	const finished =
		counted && list.every((s) => s.status === 'finished' || s.status === 'cancelled');
	// Favourite, private and spoiler stay false, their defaults: the sources do not carry them
	const merged = mergeEntries(
		parts.map((p) => ({
			season: p.season,
			offset: starts.get(p.season) ?? 0,
			count: list.find((s) => s.number === p.season)?.count ?? 0,
			entry: { ...p.entry, isFavorite: false, isPrivate: false, reviewSpoiler: false }
		})),
		{ aired: finished ? end : 0, total: counted ? end : 0, seasonEnds }
	);
	// In progress: the latest day seen still dates the journal (saveImportedEntry drops it after)
	if (merged.status === 'in_progress')
		merged.completedOn =
			parts
				.map((p) => p.entry.completedOn ?? '')
				.sort()
				.at(-1) || null;
	return merged;
}

type Stats = { total: number; imported: number; kept: number; unmatched: number };

const progressKind = { tv: 'episode', anime: 'episode', manga: 'chapter', book: 'pages' } as const;

async function resolve(db: Db, providers: Providers, item: ImportItem): Promise<Resolved | null> {
	if (item.media)
		return item.type === 'anime'
			? animeWork(db, providers, item.media)
			: { mediaId: await upsertMedia(db, item.media) };
	const id = await resolveId(db, providers, item);
	return id ? { mediaId: id } : null;
}

async function resolveId(db: Db, providers: Providers, item: ImportItem): Promise<number | null> {
	if (item.lookup && providers.book.client.lookup) {
		const { lookup } = item;
		const key = `openlibrary:lookup:${lookup.isbn13 || lookup.isbn || `${lookup.title}|${lookup.author ?? ''}`}`;
		const found = await cached(db, key.toLowerCase(), 7 * DAY, () =>
			providers.book.client.lookup!(lookup)
		);
		return found ? upsertMedia(db, found) : null;
	}
	// Provider id given by the source (Trakt gives TMDB ids): import it from that provider
	if (item.ref && providers[item.type].name === item.ref.provider) {
		return importMedia(db, providers, item.type, item.ref.externalId);
	}
	if (item.search)
		return findByTitle(db, providers, item.type, item.search.title, item.search.year);
	return null;
}

/**
 * Adds an imported entry unless the user already has one, and writes its history to the
 * journal (source "import"). Dedup keys make a replayed import add nothing.
 */
export async function saveImportedEntry(
	db: Db,
	userId: string,
	mediaId: number,
	source: ImportSource,
	imported: ImportedEntry
): Promise<'imported' | 'kept'> {
	return db.transaction(async (tx) => {
		const [m] = await tx
			.select({
				type: media.type,
				runtime: media.runtimeMinutes,
				total: media.totalUnits,
				status: media.status
			})
			.from(media)
			.where(eq(media.id, mediaId));
		// Sources can overshoot (rewatches counted as plays): never above the known total.
		// Completed without a count (Letterboxd shows): every unit seen, as updateEntry would do.
		const progress = !m.total
			? imported.progress
			: imported.status === 'completed' && !imported.progress
				? m.total
				: Math.min(imported.progress, m.total);
		// A finished work whose every unit was seen is completed, even if the source says otherwise
		const done =
			imported.status === 'in_progress' &&
			!!m.total &&
			progress >= m.total &&
			(m.status === 'finished' || m.status === 'cancelled');
		const at = (date: string | null) => (date ? new Date(`${date}T12:00:00Z`) : new Date());
		const e = { ...imported, progress, ...(done && { status: 'completed' as const }) };
		// Trakt shows carry their last day seen in completedOn: it dates the journal, not the entry
		const when = at(e.completedOn ?? e.startedOn);
		if (e.status === 'in_progress') e.completedOn = null;

		const [created] = await tx
			.insert(libraryEntries)
			.values({ userId, mediaId, ...e })
			.onConflictDoNothing()
			.returning({ id: libraryEntries.id });
		if (!created) return 'kept';

		const key = (kind: string) => `import:${source}:${mediaId}:${kind}`;
		const events: Omit<typeof activityEvents.$inferInsert, 'userId' | 'mediaId'>[] = [];
		if (e.progress > 0 && m.type !== 'movie') {
			const perUnit = m.type === 'tv' || m.type === 'anime' ? m.runtime : null;
			events.push({
				kind: progressKind[m.type],
				amount: e.progress,
				minutes: perUnit ? perUnit * e.progress : null,
				occurredAt: when,
				dedupKey: key('progress')
			});
		}
		if (e.status === 'completed') {
			events.push({ kind: 'completed', occurredAt: when, dedupKey: key('completed') });
		}
		if (e.score !== null) {
			events.push({ kind: 'rated', amount: e.score, occurredAt: when, dedupKey: key('rated') });
		}
		if (events.length) {
			await tx
				.insert(activityEvents)
				.values(events.map((ev) => ({ ...ev, userId, mediaId, source: 'import' as const })))
				.onConflictDoNothing();
		}
		return 'imported';
	});
}

/** Processes all rows of an import job and records its outcome in import_jobs. */
export async function runImport(
	db: Db,
	providers: Providers,
	job: { importId: number; userId: string; source: ImportSource; items: ImportItem[] }
): Promise<Stats> {
	const stats: Stats = { total: job.items.length, imported: 0, kept: 0, unmatched: 0 };
	const unmatched: Unmatched[] = [];
	// Running counts let the import page draw a progress bar; at most one write per second
	const saveProgress = () =>
		db.update(importJobs).set({ status: 'running', stats }).where(eq(importJobs.id, job.importId));
	await saveProgress();
	let savedAt = Date.now();
	// Seasons of one franchise (one row per AniList entry) become one entry, saved at the end
	const franchises = new Map<number, { season: number; entry: ImportedEntry }[]>();
	try {
		for (const item of job.items) {
			if (Date.now() - savedAt >= 1000) {
				await saveProgress();
				savedAt = Date.now();
			}
			let found: Resolved | null = null;
			try {
				found = await resolve(db, providers, item);
			} catch (err) {
				// One bad row (provider error, odd data) must not fail the whole import
				console.error(`[import ${job.importId}] ${item.label}`, err);
			}
			if (!found) {
				stats.unmatched++;
				unmatched.push({ label: item.label, type: item.type, reason: 'not_found' });
				continue;
			}
			if (found.season !== undefined) {
				const parts = franchises.get(found.mediaId) ?? [];
				parts.push({ season: found.season, entry: item.entry });
				franchises.set(found.mediaId, parts);
				continue;
			}
			stats[await saveImportedEntry(db, job.userId, found.mediaId, job.source, item.entry)]++;
		}
		for (const [mediaId, parts] of franchises) {
			const entry = await franchiseEntry(db, mediaId, parts);
			stats[await saveImportedEntry(db, job.userId, mediaId, job.source, entry)] += parts.length;
		}
		await db
			.update(importJobs)
			.set({ status: 'done', stats, unmatched, finishedAt: new Date() })
			.where(eq(importJobs.id, job.importId));
	} catch (err) {
		await db
			.update(importJobs)
			.set({ status: 'failed', stats, unmatched, error: String(err), finishedAt: new Date() })
			.where(eq(importJobs.id, job.importId));
		throw err;
	}
	return stats;
}
