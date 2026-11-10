// Simple statistics from the journal (activity_events): time spent, units, completions per month.
import { and, eq, gte, sql } from 'drizzle-orm';
import { MEDIA_TYPES, type MediaType } from '../labels';
import { TIMEZONE } from './calendar';
import type { Db } from './db';
import { activityEvents, media } from './db/schema';

export const STATS_MONTHS = 12;

/** The last `count` months in TIMEZONE, oldest first, as 'YYYY-MM'. */
export function lastMonths(now: Date, count = STATS_MONTHS) {
	const [y, m] = new Intl.DateTimeFormat('en-CA', {
		timeZone: TIMEZONE,
		year: 'numeric',
		month: '2-digit'
	})
		.format(now)
		.split('-')
		.map(Number);
	return Array.from({ length: count }, (_, i) => {
		const d = new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1));
		return d.toISOString().slice(0, 7);
	});
}

const zeros = () => Object.fromEntries(MEDIA_TYPES.map((t) => [t, 0])) as Record<MediaType, number>;

export async function userStats(db: Db, userId: string, now = new Date()) {
	const totals = await db
		.select({
			type: media.type,
			kind: activityEvents.kind,
			count: sql<number>`count(*)::int`,
			amount: sql<number>`coalesce(sum(${activityEvents.amount}), 0)::int`,
			minutes: sql<number>`coalesce(sum(${activityEvents.minutes}), 0)::int`
		})
		.from(activityEvents)
		.innerJoin(media, eq(media.id, activityEvents.mediaId))
		.where(eq(activityEvents.userId, userId))
		.groupBy(media.type, activityEvents.kind);

	const months = lastMonths(now);
	const month = sql<string>`to_char(${activityEvents.occurredAt} at time zone ${TIMEZONE}, 'YYYY-MM')`;
	const completions = await db
		.select({ month, type: media.type, count: sql<number>`count(*)::int` })
		.from(activityEvents)
		.innerJoin(media, eq(media.id, activityEvents.mediaId))
		.where(
			and(
				eq(activityEvents.userId, userId),
				eq(activityEvents.kind, 'completed'),
				// A day of margin before the first month; rows outside the window are dropped below
				gte(activityEvents.occurredAt, new Date(Date.parse(`${months[0]}-01T00:00:00Z`) - 864e5))
			)
		)
		// By position: the bound timezone makes `month` a different expression in GROUP BY
		.groupBy(sql`1`, media.type);

	const minutes = zeros();
	const completed = zeros();
	const units = { episode: 0, chapter: 0, pages: 0 };
	for (const r of totals) {
		minutes[r.type] += r.minutes;
		if (r.kind === 'completed') completed[r.type] += r.count;
		if (r.kind === 'episode' || r.kind === 'chapter' || r.kind === 'pages')
			units[r.kind] += r.amount;
	}
	const perMonth = months.map((m) => ({ month: m, counts: zeros() }));
	for (const r of completions) {
		const row = perMonth.find((p) => p.month === r.month);
		if (row) row.counts[r.type] = r.count;
	}
	return { minutes, completed, units, perMonth };
}
