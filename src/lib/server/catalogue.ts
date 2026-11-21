// Catalogue feeding: provider search, import, episodes and refresh, run by the worker
// (only it calls the APIs).
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import type { Db } from './db';
import {
	episodes,
	libraryEntries,
	media,
	mediaExternalIds,
	mediaTitles,
	seasons
} from './db/schema';
import { createAniListClient, type AniListClient } from './providers/anilist';
import { cached, DAY } from './providers/cache';
import { createOpenLibraryClient } from './providers/openlibrary';
import { createTmdbClient } from './providers/tmdb';
import {
	yearOf,
	type FranchiseSeason,
	type MediaType,
	type Provider,
	type ProviderClient,
	type ProviderEpisodes,
	type ProviderMedia,
	type SearchOptions,
	type SearchResult
} from './providers/types';

/** Source of truth per media type (docs/v1-spec.md), plus the AniList client for list imports. */
export type Providers = Record<MediaType, { name: Provider; client: ProviderClient }> & {
	anilist?: AniListClient;
};

export function createProviders(env: { TMDB_API_KEY?: string }): Providers {
	const tmdb: ProviderClient = env.TMDB_API_KEY
		? createTmdbClient({ apiKey: env.TMDB_API_KEY })
		: {
				types: ['movie', 'tv'],
				search: () => Promise.reject(new Error('TMDB_API_KEY is not set')),
				get: () => Promise.reject(new Error('TMDB_API_KEY is not set'))
			};
	const anilist = createAniListClient();
	const openlibrary = createOpenLibraryClient();
	return {
		movie: { name: 'tmdb', client: tmdb },
		tv: { name: 'tmdb', client: tmdb },
		anime: { name: 'anilist', client: anilist },
		manga: { name: 'anilist', client: anilist },
		book: { name: 'openlibrary', client: openlibrary },
		anilist
	};
}

const normalize = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ');

export async function searchProvider(
	db: Db,
	providers: Providers,
	type: MediaType,
	query: string,
	opts: SearchOptions = {}
): Promise<SearchResult[]> {
	const q = normalize(query);
	if (!q) return [];
	const { name, client } = providers[type];
	const key = `${name}:search:${type}:${q}${opts.year ? `:${opts.year}` : ''}${opts.english ? ':en' : ''}${opts.keepAnime ? ':anime' : ''}`;
	return (await cached(db, key, DAY, () => client.search(q, type, opts))) ?? [];
}

/** Trending works of a type, or recommendations for one work with `externalId` (cached a day). */
export async function discoverProvider(
	db: Db,
	providers: Providers,
	type: MediaType,
	externalId?: string
): Promise<SearchResult[]> {
	const { name, client } = providers[type];
	const compute = externalId
		? client.recommendations && (() => client.recommendations!(externalId, type))
		: client.trending && (() => client.trending!(type));
	if (!compute) return [];
	const key = externalId ? `${name}:recs:${type}:${externalId}` : `${name}:trending:${type}`;
	return (await cached(db, key, DAY, compute)) ?? [];
}

/**
 * Fetches a media from its provider and stores it; returns its id, or null if the provider
 * does not know it. `refresh` bypasses the cache (daily refresh of airing media).
 */
export async function importMedia(
	db: Db,
	providers: Providers,
	type: MediaType,
	externalId: string,
	opts: { refresh?: boolean } = {}
): Promise<number | null> {
	const { name, client } = providers[type];
	const data = await cached(
		db,
		`${name}:media:${type}:${externalId}`,
		DAY,
		() => client.get(externalId, type),
		opts
	);
	return data ? upsertMedia(db, data) : null;
}

/** Inserts or refreshes a media, matched on its primary external id. */
export function upsertMedia(db: Db, data: ProviderMedia): Promise<number> {
	const [primary, ...others] = data.externalIds;
	const values = { ...data.media, lastSyncedAt: new Date() };
	return db.transaction(async (tx) => {
		// Serializes concurrent imports of the same work, so it is never created twice
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext(${`${primary.provider}:${primary.externalId}`}))`
		);
		const [existing] = await tx
			.select({ id: mediaExternalIds.mediaId })
			.from(mediaExternalIds)
			.where(
				and(
					eq(mediaExternalIds.provider, primary.provider),
					eq(mediaExternalIds.externalId, primary.externalId)
				)
			);

		let mediaId: number;
		if (existing) {
			mediaId = existing.id;
			// Merged, so keys Vulu adds (the TMDB match of an anime) survive refreshes
			const extra = sql`${media.extra} || ${JSON.stringify(values.extra ?? {})}::jsonb`;
			await tx
				.update(media)
				.set({ ...values, extra })
				.where(eq(media.id, mediaId));
		} else {
			[{ id: mediaId }] = await tx.insert(media).values(values).returning({ id: media.id });
			await tx.insert(mediaExternalIds).values({ mediaId, ...primary, isPrimary: true });
		}
		// Secondary ids may already belong to another media (e.g. a TMDB entry of the same anime): keep theirs.
		if (others.length) {
			await tx
				.insert(mediaExternalIds)
				.values(others.map((id) => ({ mediaId, ...id })))
				.onConflictDoNothing();
		}
		if (data.titles.length) {
			await tx
				.insert(mediaTitles)
				.values(data.titles.map((t) => ({ mediaId, ...t })))
				.onConflictDoNothing();
		}
		// Anime franchise: one season per AniList entry; their episodes come with syncEpisodes
		if (data.seasons?.length) {
			await tx
				.insert(seasons)
				.values(data.seasons.map((s) => ({ mediaId, ...s })))
				.onConflictDoUpdate({
					target: [seasons.mediaId, seasons.number],
					set: {
						anilistId: sql`excluded.anilist_id`,
						title: sql`excluded.title`,
						airDate: sql`excluded.air_date`,
						status: sql`excluded.status`,
						episodeCount: sql`excluded.episode_count`,
						posterUrl: sql`excluded.poster_url`
					}
				});
			await tx
				.delete(seasons)
				.where(and(eq(seasons.mediaId, mediaId), gt(seasons.number, data.seasons.length)));
		}
		return mediaId;
	});
}

/** Types whose episodes are synced (calendar, runtime). */
export const hasEpisodes = (type: MediaType) => type === 'tv' || type === 'anime';

/** Fetches seasons and episodes of a TV show or anime and stores them; returns the episode count. */
export async function syncEpisodes(
	db: Db,
	providers: Providers,
	mediaId: number
): Promise<number | null> {
	const [row] = await db
		.select({
			type: media.type,
			provider: mediaExternalIds.provider,
			externalId: mediaExternalIds.externalId,
			startDate: media.startDate,
			totalUnits: media.totalUnits,
			runtimeMinutes: media.runtimeMinutes,
			extra: media.extra
		})
		.from(media)
		.innerJoin(
			mediaExternalIds,
			and(eq(mediaExternalIds.mediaId, media.id), eq(mediaExternalIds.isPrimary, true))
		)
		.where(eq(media.id, mediaId));
	if (!row || !hasEpisodes(row.type)) return null;
	const { name, client } = providers[row.type];
	if (row.provider !== name || !client.episodes) return null;
	if (row.type === 'anime') {
		const list = await db
			.select({
				number: seasons.number,
				anilistId: seasons.anilistId,
				title: seasons.title,
				airDate: seasons.airDate,
				status: seasons.status,
				episodeCount: seasons.episodeCount,
				posterUrl: seasons.posterUrl
			})
			.from(seasons)
			.where(and(eq(seasons.mediaId, mediaId), isNotNull(seasons.anilistId)))
			.orderBy(asc(seasons.number));
		if (list.length)
			return storeEpisodes(db, mediaId, await franchiseEpisodes(db, providers, mediaId, row, list));
	}
	const data = await client.episodes(row.externalId, row.type);
	if (!data) return null;
	if (row.type === 'anime' && row.extra.format !== 'MOVIE' && row.startDate) {
		try {
			const show = await tmdbAnimeShow(db, providers, mediaId, {
				...row,
				startDate: row.startDate
			});
			const full = show && matchAnimeEpisodes(show, row.startDate, row.totalUnits);
			if (full) data.episodes = mergeSchedule(full, data.episodes);
		} catch (err) {
			// TMDB is a complement: without it the AniList schedule is still stored
			console.warn(`[episodes] TMDB episodes for anime ${mediaId} failed`, err);
		}
	}
	return storeEpisodes(db, mediaId, data);
}

type FranchiseRow = Omit<FranchiseSeason, 'anilistId'> & { anilistId: string | null };

/**
 * Episodes of an anime franchise, season by season (docs/franchises-anime.md): numbered from
 * AniList's counts, with TMDB titles, synopses and stills where a season lines up with the TMDB
 * show, and AniList's exact times for scheduled ones. Absolute numbers run across seasons.
 */
async function franchiseEpisodes(
	db: Db,
	providers: Providers,
	mediaId: number,
	franchise: { runtimeMinutes: number | null; extra: Record<string, unknown> },
	list: FranchiseRow[]
): Promise<ProviderEpisodes> {
	const airing = list.filter((s) => s.status === 'releasing' || s.status === 'announced');
	const schedules =
		airing.length && providers.anilist
			? await providers.anilist.schedules(airing.map((s) => s.anilistId!))
			: new Map<string, { episode: number; airingAt: number }[]>();
	let show: ProviderEpisodes['episodes'] | null = null;
	const first = list[0];
	if (first.airDate) {
		try {
			show = await tmdbAnimeShow(db, providers, mediaId, {
				startDate: first.airDate,
				totalUnits: first.episodeCount,
				extra: franchise.extra
			});
		} catch (err) {
			// TMDB is a complement: without it, episodes are numbered from AniList alone
			console.warn(`[episodes] TMDB episodes for anime ${mediaId} failed`, err);
		}
	}

	const episodes: ProviderEpisodes['episodes'] = [];
	let absolute = 0;
	for (const s of list) {
		const tmdb = new Map(
			((show && s.airDate && matchAnimeEpisodes(show, s.airDate, s.episodeCount)) || []).map(
				(e) => [e.number, e]
			)
		);
		const schedule = new Map(
			(schedules.get(s.anilistId!) ?? []).map((n) => [n.episode, new Date(n.airingAt * 1000)])
		);
		// A finished season has its count; an airing one goes as far as TMDB or the schedule
		const known = Math.max(tmdb.size, ...schedule.keys(), 0);
		const count =
			s.status === 'releasing' || s.status === 'announced'
				? Math.min(known, s.episodeCount ?? known)
				: (s.episodeCount ?? known);
		for (let n = 1; n <= count; n++) {
			const t = tmdb.get(n);
			episodes.push({
				seasonNumber: s.number,
				number: n,
				absoluteNumber: absolute + n,
				title: t?.title ?? null,
				airDate: schedule.get(n) ?? t?.airDate ?? null,
				runtimeMinutes: t?.runtimeMinutes ?? franchise.runtimeMinutes,
				overview: t?.overview ?? null,
				stillUrl: t?.stillUrl ?? null
			});
		}
		absolute += count;
	}
	return { upcomingOnly: false, seasons: list, episodes };
}

/**
 * Every episode of the TMDB show of an anime (titles, synopses, stills), which AniList does not
 * have; the show is checked by an episode aired on the anime's start date. The match is stored in
 * `extra.tmdbId` (set it by hand to fix a wrong one): one TMDB show spans several AniList entries,
 * so it cannot be an external id. Null when nothing matches for sure.
 */
async function tmdbAnimeShow(
	db: Db,
	providers: Providers,
	mediaId: number,
	anime: { startDate: string; totalUnits: number | null; extra: Record<string, unknown> }
): Promise<ProviderEpisodes['episodes'] | null> {
	const tmdb = providers.tv.client;
	if (!tmdb.episodes) return null;
	const tried = new Set<string>();
	const attempt = async (id: string) => {
		tried.add(id);
		const show = await tmdb.episodes!(id, 'tv');
		return show && matchAnimeEpisodes(show.episodes, anime.startDate, anime.totalUnits)
			? show.episodes
			: null;
	};
	const known = anime.extra.tmdbId;
	if (typeof known === 'string') return attempt(known);

	const titles = await db
		.select({ title: mediaTitles.title })
		.from(mediaTitles)
		.where(and(eq(mediaTitles.mediaId, mediaId), inArray(mediaTitles.locale, ['en', 'ja-Latn'])));
	// Sequels are searched without their marker ("Season 2", ": Part 2") if the full title fails
	const base = (t: string) =>
		t
			.replace(/\b(season|part|cour)\s*\d+\b|\b\d+(st|nd|rd|th)\s+season\b/gi, '')
			.split(':')[0]
			.trim();
	const queries = new Set([...titles.map((t) => t.title), ...titles.map((t) => base(t.title))]);
	const year = yearOf(anime.startDate)!;
	for (const q of queries) {
		if (!q) continue;
		const results = await searchProvider(db, providers, 'tv', q, { keepAnime: true });
		// A sequel belongs to a show that started the same year or before
		const ids = results
			.filter((r) => r.anime && r.year && r.year <= year && !tried.has(r.externalId))
			.slice(0, 2)
			.map((r) => r.externalId);
		for (const id of ids) {
			if (tried.size >= 3) break;
			const found = await attempt(id);
			if (!found) continue;
			await db
				.update(media)
				.set({ extra: sql`${media.extra} || ${JSON.stringify({ tmdbId: id })}::jsonb` })
				.where(eq(media.id, mediaId));
			return found;
		}
	}
	// Tried: pages stop queueing syncs for it; the daily refresh of airing anime still retries
	await db
		.update(media)
		.set({ extra: sql`${media.extra} || '{"tmdbId": null}'::jsonb` })
		.where(eq(media.id, mediaId));
	return null;
}

const DAY_MS = 86_400_000;

/**
 * The anime's run inside a TMDB show: TMDB seasons rarely follow AniList entries (split cours,
 * one long season), so the TMDB episodes are numbered across seasons and the run starts at the
 * one aired on the anime's start date (two days of slack). Null when no episode aired then.
 */
export function matchAnimeEpisodes(
	tmdb: ProviderEpisodes['episodes'],
	startDate: string,
	total: number | null
): ProviderEpisodes['episodes'] | null {
	const eps = tmdb
		.filter((e) => e.absoluteNumber !== null)
		.sort((a, b) => a.absoluteNumber! - b.absoluteNumber!);
	const start = Date.parse(`${startDate}T00:00:00Z`);
	const time = (e: (typeof eps)[number]) => (e.airDate ? new Date(e.airDate).getTime() : NaN);
	const near = (e: (typeof eps)[number]) => Math.abs(time(e) - start) <= 2 * DAY_MS;
	// shortcut: without an AniList episode count (still airing) every later TMDB episode is taken,
	// which may run into the next AniList entry; cap it if that shows up
	const take = (from: number, count: number | null) =>
		eps.slice(from, count === null ? undefined : from + count);
	let run: ProviderEpisodes['episodes'];
	const first = eps.findIndex(near);
	if (first >= 0) run = take(first, total);
	else {
		// An "episode 0" AniList counts and TMDB files as a special: it opens the run, the
		// numbered episodes of the following week go on
		const zero = tmdb.find((e) => e.absoluteNumber === null && near(e));
		const next = eps.findIndex((e) => time(e) > start && time(e) - start <= 9 * DAY_MS);
		if (!zero || next < 0) return null;
		run = [zero, ...take(next, total === null ? null : total - 1)];
	}
	return run.map((e, i) => ({ ...e, seasonNumber: null, number: i + 1, absoluteNumber: i + 1 }));
}

/** TMDB episodes, with AniList's exact air times; scheduled episodes TMDB lacks are kept. */
export function mergeSchedule(
	full: ProviderEpisodes['episodes'],
	schedule: ProviderEpisodes['episodes']
): ProviderEpisodes['episodes'] {
	const byNumber = new Map(schedule.map((e) => [e.number, e]));
	const numbers = new Set(full.map((e) => e.number));
	return [
		...full.map((e) => ({
			...e,
			airDate: byNumber.get(e.number)?.airDate ?? e.airDate,
			runtimeMinutes: e.runtimeMinutes ?? byNumber.get(e.number)?.runtimeMinutes ?? null
		})),
		...schedule.filter((e) => !numbers.has(e.number))
	];
}

const CHUNK = 500; // keeps each insert well under PostgreSQL's parameter limit

/** Upserts seasons and episodes; with an airing schedule, drops future episodes no longer listed. */
export function storeEpisodes(db: Db, mediaId: number, data: ProviderEpisodes): Promise<number> {
	return db.transaction(async (tx) => {
		const seasonIds = new Map<number, number>();
		if (data.seasons.length) {
			const rows = await tx
				.insert(seasons)
				.values(data.seasons.map((s) => ({ mediaId, ...s })))
				.onConflictDoUpdate({
					target: [seasons.mediaId, seasons.number],
					set: {
						title: sql`excluded.title`,
						airDate: sql`excluded.air_date`,
						episodeCount: sql`excluded.episode_count`,
						posterUrl: sql`excluded.poster_url`
					}
				})
				.returning({ id: seasons.id, number: seasons.number });
			for (const r of rows) seasonIds.set(r.number, r.id);
		}

		const rows = data.episodes.map(({ seasonNumber, ...e }) => ({
			mediaId,
			seasonId: seasonNumber === null ? null : (seasonIds.get(seasonNumber) ?? null),
			...e
		}));
		const set = {
			absoluteNumber: sql`excluded.absolute_number`,
			title: sql`excluded.title`,
			airDate: sql`excluded.air_date`,
			runtimeMinutes: sql`excluded.runtime_minutes`,
			overview: sql`excluded.overview`,
			stillUrl: sql`excluded.still_url`
		};
		const withSeason = rows.filter((r) => r.seasonId !== null);
		const withoutSeason = rows.filter((r) => r.seasonId === null);
		for (let i = 0; i < withSeason.length; i += CHUNK) {
			await tx
				.insert(episodes)
				.values(withSeason.slice(i, i + CHUNK))
				.onConflictDoUpdate({ target: [episodes.seasonId, episodes.number], set });
		}
		for (let i = 0; i < withoutSeason.length; i += CHUNK) {
			await tx
				.insert(episodes)
				.values(withoutSeason.slice(i, i + CHUNK))
				.onConflictDoUpdate({
					target: [episodes.mediaId, episodes.number],
					targetWhere: isNull(episodes.seasonId),
					set
				});
		}

		if (data.upcomingOnly) {
			// Delayed or cancelled episodes leave the schedule: drop them from the calendar
			const listed = withoutSeason.map((e) => e.number);
			await tx
				.delete(episodes)
				.where(
					and(
						eq(episodes.mediaId, mediaId),
						isNull(episodes.seasonId),
						gt(episodes.airDate, new Date()),
						listed.length ? notInArray(episodes.number, listed) : undefined
					)
				);
		}

		// TMDB no longer gives a show-level runtime: use the median episode runtime
		const runtimes = rows
			.map((e) => e.runtimeMinutes)
			.filter((r): r is number => !!r)
			.sort((a, b) => a - b);
		if (runtimes.length) {
			await tx
				.update(media)
				.set({ runtimeMinutes: runtimes[Math.floor(runtimes.length / 2)] })
				.where(and(eq(media.id, mediaId), isNull(media.runtimeMinutes)));
		}
		return rows.length;
	});
}

/**
 * Media to refresh daily: airing or announced, followed by at least one user, and not synced
 * in the last 20 hours (uses media_sync_queue_idx).
 */
export function staleAiringMedia(db: Db, limit = 1000) {
	return db
		.select({
			id: media.id,
			type: media.type,
			provider: mediaExternalIds.provider,
			externalId: mediaExternalIds.externalId
		})
		.from(media)
		.innerJoin(
			mediaExternalIds,
			and(eq(mediaExternalIds.mediaId, media.id), eq(mediaExternalIds.isPrimary, true))
		)
		.where(
			and(
				inArray(media.status, ['releasing', 'announced']),
				or(isNull(media.lastSyncedAt), lt(media.lastSyncedAt, sql`now() - interval '20 hours'`)),
				sql`exists (select 1 from ${libraryEntries} where ${libraryEntries.mediaId} = ${media.id})`
			)
		)
		.limit(limit);
}

/** A user's TV shows and anime still airing whose episodes were never synced (e.g. after an import). */
export async function airingWithoutEpisodes(db: Db, userId: string): Promise<number[]> {
	const rows = await db
		.select({ id: media.id })
		.from(libraryEntries)
		.innerJoin(media, eq(media.id, libraryEntries.mediaId))
		.where(
			and(
				eq(libraryEntries.userId, userId),
				inArray(media.type, ['tv', 'anime']),
				inArray(media.status, ['releasing', 'announced']),
				sql`not exists (select 1 from ${episodes} where ${episodes.mediaId} = ${media.id})`
			)
		);
	return rows.map((r) => r.id);
}
