// Runs a library import in the worker: resolves each row to a catalogue media, then adds it
// to the user's library. Existing entries are kept as they are (V1 choice).
import { eq } from 'drizzle-orm';
import { importMedia, searchProvider, upsertMedia, type Providers } from '../catalogue';
import type { Db } from '../db';
import { activityEvents, importJobs, libraryEntries, media } from '../db/schema';
import { cached, DAY } from '../providers/cache';
import type { MediaType, SearchResult } from '../providers/types';
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
			await searchProvider(db, providers, t, title, { year: year ?? undefined, english: true })
		).filter((r) => year === null || (r.year !== null && Math.abs(r.year - year) <= 1));
	const q = norm(title);
	const same = (r: SearchResult) => [r.title, r.originalTitle].some((t) => t && norm(t) === q);
	const works = await near(type);
	let hit = mostRated(works.filter(same));
	if (!hit && type === 'movie') hit = mostRated((await near('tv')).filter(same));
	hit ??= mostRated(works.filter((r) => norm(r.title).startsWith(`${q} `)));
	return hit ? importMedia(db, providers, hit.type, hit.externalId) : null;
}

type Stats = { total: number; imported: number; kept: number; unmatched: number };

const progressKind = { tv: 'episode', anime: 'episode', manga: 'chapter', book: 'pages' } as const;

async function resolve(db: Db, providers: Providers, item: ImportItem): Promise<number | null> {
	if (item.media) return upsertMedia(db, item.media);
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
		// Sources can overshoot (rewatches counted as plays): never above the known total
		const progress = m.total ? Math.min(imported.progress, m.total) : imported.progress;
		// A finished work whose every unit was seen is completed, even if the source says otherwise
		const done =
			imported.status === 'in_progress' &&
			!!m.total &&
			progress >= m.total &&
			(m.status === 'finished' || m.status === 'cancelled');
		const e = { ...imported, progress, ...(done && { status: 'completed' as const }) };

		const [created] = await tx
			.insert(libraryEntries)
			.values({ userId, mediaId, ...e })
			.onConflictDoNothing()
			.returning({ id: libraryEntries.id });
		if (!created) return 'kept';

		const at = (date: string | null) => (date ? new Date(`${date}T12:00:00Z`) : new Date());
		const when = at(e.completedOn ?? e.startedOn);
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
	await db.update(importJobs).set({ status: 'running' }).where(eq(importJobs.id, job.importId));
	const stats: Stats = { total: job.items.length, imported: 0, kept: 0, unmatched: 0 };
	const unmatched: Unmatched[] = [];
	try {
		for (const item of job.items) {
			let mediaId: number | null = null;
			try {
				mediaId = await resolve(db, providers, item);
			} catch (err) {
				// One bad row (provider error, odd data) must not fail the whole import
				console.error(`[import ${job.importId}] ${item.label}`, err);
			}
			if (!mediaId) {
				stats.unmatched++;
				unmatched.push({ label: item.label, type: item.type, reason: 'not_found' });
				continue;
			}
			stats[await saveImportedEntry(db, job.userId, mediaId, job.source, item.entry)]++;
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
