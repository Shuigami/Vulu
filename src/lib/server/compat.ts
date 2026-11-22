// Taste compatibility between two members, from the works both of them scored.
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from './db';
import { libraryEntries, media, users } from './db/schema';
import { visibleTo } from './social';

/** Below this many works scored by both, there is no percentage. */
export const COMPAT_MIN = 3;

/** 100 when every score matches; each point of average gap (out of 100) costs two. */
export const compatPercent = (diffs: number[]) =>
	diffs.length < COMPAT_MIN
		? null
		: Math.max(
				0,
				Math.round(100 - (2 * diffs.reduce((n, d) => n + Math.abs(d), 0)) / diffs.length)
			);

/** `a` and `b`'s scores as `viewerId` may see them (each side follows `visibleTo`). */
export async function compatibility(db: Db, a: string, b: string, viewerId: string) {
	const scored = (userId: string, alias: string) =>
		db
			.select({ mediaId: libraryEntries.mediaId, score: libraryEntries.score })
			.from(libraryEntries)
			.innerJoin(users, eq(users.id, libraryEntries.userId))
			.where(
				and(eq(libraryEntries.userId, userId), isNotNull(libraryEntries.score), visibleTo(viewerId))
			)
			.as(alias);
	const sa = scored(a, 'sa');
	const sb = scored(b, 'sb');
	const rows = await db
		.select({
			mediaId: media.id,
			title: media.title,
			type: media.type,
			posterUrl: media.posterUrl,
			a: sql<number>`${sa.score}`,
			b: sql<number>`${sb.score}`
		})
		.from(sa)
		.innerJoin(sb, eq(sb.mediaId, sa.mediaId))
		.innerJoin(media, eq(media.id, sa.mediaId))
		.where(eq(media.isAdult, false));

	const gap = (r: (typeof rows)[number]) => Math.abs(r.a - r.b);
	return {
		shared: rows.length,
		percent: compatPercent(rows.map((r) => r.a - r.b)),
		// Both loved it: highest combined score
		loved: rows
			.filter((r) => r.a >= 70 && r.b >= 70)
			.sort((x, y) => y.a + y.b - (x.a + x.b))
			.slice(0, 6),
		// The fights: at least 3 points out of 10 apart
		clashes: rows
			.filter((r) => gap(r) >= 30)
			.sort((x, y) => gap(y) - gap(x))
			.slice(0, 4)
	};
}

export type Compatibility = Awaited<ReturnType<typeof compatibility>>;

/** A friendly word for the percentage. */
export function compatVerdict(percent: number) {
	if (percent >= 85) return 'Âmes sœurs culturelles';
	if (percent >= 70) return 'Sur la même longueur d’onde';
	if (percent >= 50) return 'Des goûts qui se croisent';
	if (percent >= 30) return 'Ça va débattre';
	return 'Tout vous oppose';
}
