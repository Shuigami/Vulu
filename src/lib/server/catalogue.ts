// Catalogue feeding: provider search, import, episodes and refresh, run by the worker
// (only it calls the APIs).
import { and, eq, gt, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
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
import type {
	MediaType,
	Provider,
	ProviderClient,
	ProviderEpisodes,
	ProviderMedia,
	SearchResult
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
	query: string
): Promise<SearchResult[]> {
	const q = normalize(query);
	if (!q) return [];
	const { name, client } = providers[type];
	return (await cached(db, `${name}:search:${type}:${q}`, DAY, () => client.search(q, type))) ?? [];
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
			await tx.update(media).set(values).where(eq(media.id, mediaId));
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
			externalId: mediaExternalIds.externalId
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
	const data = await client.episodes(row.externalId, row.type);
	return data ? storeEpisodes(db, mediaId, data) : null;
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
			runtimeMinutes: sql`excluded.runtime_minutes`
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
