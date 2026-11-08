import type { PgBoss } from 'pg-boss';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { MEDIA_TYPES, type MediaType } from '../labels';
import type { Db } from './db';
import { media, mediaExternalIds, mediaTitles } from './db/schema';
import { QUEUES, requestJob, type SearchOutput } from './jobs';
import type { SearchResult } from './providers/types';

/** Below this many local results, providers are queried too (docs/v1-spec.md). */
export const LOCAL_ENOUGH = 5;

/**
 * Accent- and case-insensitive fuzzy search over all known titles of a media.
 * Uses word similarity (`<%`), so a query can match part of a longer title;
 * the expression matches media_titles_trgm_idx so the GIN index is used.
 * Adult media are excluded (V1 choice).
 */
export function searchMedia(
	db: Pick<Db, 'select'>,
	query: string,
	opts: { type?: MediaType; limit?: number } = {}
) {
	const q = sql`f_unaccent(lower(${query}))`;
	const title = sql`f_unaccent(lower(${mediaTitles.title}))`;
	const score = sql<number>`max(word_similarity(${q}, ${title}))`.mapWith(Number);
	return db
		.select({
			id: media.id,
			type: media.type,
			title: media.title,
			posterUrl: media.posterUrl,
			year: sql<number | null>`extract(year from ${media.startDate})::int`,
			score
		})
		.from(mediaTitles)
		.innerJoin(media, eq(media.id, mediaTitles.mediaId))
		.where(
			and(
				sql`${q} <% ${title}`,
				eq(media.isAdult, false),
				opts.type ? eq(media.type, opts.type) : undefined
			)
		)
		.groupBy(media.id)
		.orderBy(desc(score))
		.limit(opts.limit ?? 20);
}

export type LocalResult = Awaited<ReturnType<typeof searchMedia>>[number];

/**
 * Provider results for the types searched, through the worker. Results already in the
 * catalogue are dropped (the local search shows them). `failed` is true when a provider
 * could not answer, so the page can say results may be missing.
 */
export async function searchProviders(
	db: Db,
	boss: PgBoss,
	query: string,
	type?: MediaType
): Promise<{ results: SearchResult[]; failed: boolean }> {
	const types = type ? [type] : MEDIA_TYPES;
	const settled = await Promise.allSettled(
		types.map((t) => requestJob<SearchOutput>(boss, QUEUES.search, { type: t, query }))
	);
	const results = settled
		.flatMap((s) => (s.status === 'fulfilled' ? s.value.results : []))
		.filter((r) => !r.isAdult);
	const errors = settled.filter((s) => s.status === 'rejected').map((s) => s.reason);
	for (const err of errors) console.error('[search] provider search failed', err);
	const failed = errors.length > 0;
	if (!results.length) return { results, failed };

	const known = await db
		.select({ provider: mediaExternalIds.provider, externalId: mediaExternalIds.externalId })
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
	const isKnown = new Set(known.map((k) => `${k.provider}:${k.externalId}`));
	return { results: results.filter((r) => !isKnown.has(`${r.provider}:${r.externalId}`)), failed };
}
