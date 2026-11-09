// Home page discovery: provider trending, recommendations from what the user liked,
// and what is popular among Vulu members. Providers are reached through the worker.
import { and, desc, eq, gte, inArray, ne, or, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { MEDIA_TYPES, type MediaType } from '../labels';
import type { Db } from './db';
import { activityEvents, libraryEntries, media, mediaExternalIds, users } from './db/schema';
import { QUEUES, requestJob, type DiscoverJob, type SearchOutput } from './jobs';
import type { SearchResult } from './providers/types';
import { visibleTo } from './social';

/** A provider result, linked to the catalogue when Vulu already has it. */
export type DiscoverItem = SearchResult & { mediaId: number | null; because?: string };

const keyOf = (r: { provider: string; externalId: string }) => `${r.provider}:${r.externalId}`;

/** Catalogue ids of provider results already imported, by `provider:externalId`. */
async function knownIds(db: Db, results: SearchResult[]) {
	if (!results.length) return new Map<string, number>();
	const rows = await db
		.select({
			provider: mediaExternalIds.provider,
			externalId: mediaExternalIds.externalId,
			mediaId: mediaExternalIds.mediaId
		})
		.from(mediaExternalIds)
		.where(
			or(
				...results.map((r) =>
					and(
						eq(mediaExternalIds.provider, r.provider),
						eq(mediaExternalIds.externalId, r.externalId)
					)
				)
			)
		);
	return new Map(rows.map((r) => [keyOf(r), r.mediaId]));
}

const discover = (boss: PgBoss, job: DiscoverJob) =>
	requestJob<SearchOutput>(boss, QUEUES.discover, job).then((o) => o.results);

/** Trending works per type; a type whose provider fails is left empty. */
export async function trending(db: Db, boss: PgBoss) {
	const settled = await Promise.allSettled(MEDIA_TYPES.map((type) => discover(boss, { type })));
	const lists = settled.map((s) =>
		s.status === 'fulfilled' ? s.value.filter((r) => !r.isAdult).slice(0, 18) : []
	);
	const known = await knownIds(db, lists.flat());
	return Object.fromEntries(
		MEDIA_TYPES.map((type, i) => [
			type,
			lists[i].map((r): DiscoverItem => ({ ...r, mediaId: known.get(keyOf(r)) ?? null }))
		])
	) as Record<MediaType, DiscoverItem[]>;
}

/**
 * Merges the recommendations of several liked works: a work recommended from more of them
 * ranks higher, then by its best position. `exclude` holds `provider:externalId` keys.
 */
export function rankRecommendations(
	lists: { seed: string; results: SearchResult[] }[],
	exclude: Set<string>,
	limit = 18
) {
	const byKey = new Map<
		string,
		{ result: SearchResult; because: string; hits: number; best: number }
	>();
	for (const { seed, results } of lists) {
		results.forEach((result, position) => {
			const key = keyOf(result);
			if (result.isAdult || exclude.has(key)) return;
			const seen = byKey.get(key);
			if (seen) {
				seen.hits++;
				seen.best = Math.min(seen.best, position);
			} else byKey.set(key, { result, because: seed, hits: 1, best: position });
		});
	}
	return [...byKey.values()]
		.sort((a, b) => b.hits - a.hits || a.best - b.best)
		.slice(0, limit)
		.map((c) => ({ ...c.result, because: c.because }));
}

/** Recommendations from the user's favourite and best-rated works (books have none). */
export async function recommendations(db: Db, boss: PgBoss, userId: string) {
	const seeds = await db
		.select({
			title: media.title,
			type: media.type,
			externalId: mediaExternalIds.externalId
		})
		.from(libraryEntries)
		.innerJoin(media, eq(media.id, libraryEntries.mediaId))
		.innerJoin(
			mediaExternalIds,
			and(eq(mediaExternalIds.mediaId, media.id), eq(mediaExternalIds.isPrimary, true))
		)
		.where(
			and(
				eq(libraryEntries.userId, userId),
				ne(media.type, 'book'),
				or(eq(libraryEntries.isFavorite, true), gte(libraryEntries.score, 70))
			)
		)
		.orderBy(
			desc(libraryEntries.isFavorite),
			sql`${libraryEntries.score} desc nulls last`,
			desc(libraryEntries.updatedAt)
		)
		.limit(5);
	if (!seeds.length) return [];

	const settled = await Promise.allSettled(
		seeds.map((s) => discover(boss, { type: s.type, externalId: s.externalId }))
	);
	const lists = seeds.map((s, i) => {
		const r = settled[i];
		return { seed: s.title, results: r.status === 'fulfilled' ? r.value : [] };
	});

	// Leave out what the user already has
	const known = await knownIds(
		db,
		lists.flatMap((l) => l.results)
	);
	const owned = known.size
		? await db
				.select({ mediaId: libraryEntries.mediaId })
				.from(libraryEntries)
				.where(
					and(
						eq(libraryEntries.userId, userId),
						inArray(libraryEntries.mediaId, [...known.values()])
					)
				)
		: [];
	const ownedIds = new Set(owned.map((o) => o.mediaId));
	const exclude = new Set([...known].filter(([, id]) => ownedIds.has(id)).map(([key]) => key));
	return rankRecommendations(lists, exclude).map((r): DiscoverItem => ({
		...r,
		mediaId: known.get(keyOf(r)) ?? null
	}));
}

/** Works with the most members active on them this week (imports left out). */
export function popularOnVulu(db: Db, viewerId: string, limit = 12) {
	const members = sql<number>`count(distinct ${activityEvents.userId})::int`;
	return db
		.select({
			mediaId: media.id,
			title: media.title,
			type: media.type,
			posterUrl: media.posterUrl,
			members
		})
		.from(activityEvents)
		.innerJoin(users, eq(users.id, activityEvents.userId))
		.innerJoin(
			libraryEntries,
			and(
				eq(libraryEntries.userId, activityEvents.userId),
				eq(libraryEntries.mediaId, activityEvents.mediaId)
			)
		)
		.innerJoin(media, eq(media.id, activityEvents.mediaId))
		.where(
			and(
				gte(activityEvents.occurredAt, sql`now() - interval '7 days'`),
				ne(activityEvents.source, 'import'),
				eq(media.isAdult, false),
				visibleTo(viewerId)
			)
		)
		.groupBy(media.id)
		.orderBy(desc(members), desc(sql`max(${activityEvents.occurredAt})`))
		.limit(limit);
}
