import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from './db';
import { media, mediaTitles } from './db/schema';

/**
 * Accent- and case-insensitive fuzzy search over all known titles of a media.
 * Uses word similarity (`<%`), so a query can match part of a longer title;
 * the expression matches media_titles_trgm_idx so the GIN index is used.
 */
export function searchMedia(db: Pick<Db, 'select'>, query: string, limit = 20) {
	const q = sql`f_unaccent(lower(${query}))`;
	const title = sql`f_unaccent(lower(${mediaTitles.title}))`;
	const score = sql<number>`max(word_similarity(${q}, ${title}))`.mapWith(Number);
	return db
		.select({ id: media.id, type: media.type, title: media.title, score })
		.from(mediaTitles)
		.innerJoin(media, eq(media.id, mediaTitles.mediaId))
		.where(sql`${q} <% ${title}`)
		.groupBy(media.id)
		.orderBy(desc(score))
		.limit(limit);
}
