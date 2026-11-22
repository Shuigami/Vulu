// Yearly recap ("Récap 2026") from the journal. Nothing is computed before RECAP_RELEASE: until
// then pages and images only show a teaser, so no data can leak through the HTML or previews.
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { MEDIA_TYPES, type MediaType } from '../labels';
import { TIMEZONE } from './calendar';
import type { Db } from './db';
import { activityEvents, genres, libraryEntries, media, mediaGenres, users } from './db/schema';
import { visibleTo } from './social';

export const RECAP_YEAR = 2026;
/** The recap opens at midnight, Paris time. */
export const RECAP_RELEASE = new Date('2026-12-01T00:00:00+01:00');
/** The home page banner (teaser, then the recap) disappears after this. */
export const RECAP_BANNER_END = new Date('2027-02-01T00:00:00+01:00');

/** Posters on the page's opening wall. */
export const RECAP_WALL = 32;
/** Posters shown on the perfect-scores slide */
export const RECAP_FAVORITES = 60;

export const recapOpen = (now = new Date()) => now >= RECAP_RELEASE;

const zeros = () => Object.fromEntries(MEDIA_TYPES.map((t) => [t, 0])) as Record<MediaType, number>;

export type Personality = { title: string; text: string };

const DOMINANT: Record<MediaType, Personality> = {
	movie: { title: 'Cinéphile', text: 'La salle obscure, c’est ta deuxième maison.' },
	tv: { title: 'Binge-watcher', text: 'Encore un épisode… et puis un autre.' },
	anime: { title: 'Otaku assumé', text: 'Les openings, tu les connais par cœur.' },
	manga: { title: 'Dévoreur de mangas', text: 'Un tome n’attend jamais longtemps.' },
	book: { title: 'Rat de bibliothèque', text: 'Ta pile à lire ne fait pas peur.' }
};

/** A fun label from the year's numbers; null for an empty year. */
export function personality(r: {
	completed: Record<MediaType, number>;
	minutes: Record<MediaType, number>;
	nightShare: number;
	tracked: number;
}): Personality | null {
	const total = MEDIA_TYPES.reduce((n, t) => n + r.completed[t], 0);
	if (!total) return null;
	if (r.tracked >= 20 && r.nightShare >= 0.35)
		return { title: 'Oiseau de nuit', text: 'Tu vis quand les autres dorment.' };
	if (MEDIA_TYPES.filter((t) => r.completed[t] >= 3).length >= 3)
		return { title: 'Touche-à-tout', text: 'Tu ne choisis pas : tu prends tout.' };
	const top = [...MEDIA_TYPES].sort(
		(a, b) => r.completed[b] - r.completed[a] || r.minutes[b] - r.minutes[a]
	)[0];
	return DOMINANT[top];
}

/**
 * `userId`'s year as `viewerId` may see it (private entries and profiles follow `visibleTo`).
 * Imported events keep their original dates, so they count in the year they happened.
 */
export async function yearRecap(db: Db, userId: string, viewerId: string, year = RECAP_YEAR) {
	// The year's events of visible entries (joins the owner and their entry for `visibleTo`)
	const ev = db
		.select({
			mediaId: media.id,
			type: media.type,
			title: media.title,
			posterUrl: media.posterUrl,
			score: libraryEntries.score,
			kind: activityEvents.kind,
			amount: activityEvents.amount,
			minutes: activityEvents.minutes,
			source: activityEvents.source,
			// Paris wall-clock time, for months, days and hours
			local: sql<string>`(${activityEvents.occurredAt} at time zone ${TIMEZONE})`.as('local')
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
				eq(activityEvents.userId, userId),
				sql`extract(year from ${activityEvents.occurredAt} at time zone ${TIMEZONE}) = ${year}`,
				visibleTo(viewerId)
			)
		)
		.as('ev');
	const isCompleted = eq(ev.kind, 'completed');

	const [totals, months, top, [genre], [habits], wall, favorites] = await Promise.all([
		db
			.select({
				type: ev.type,
				kind: ev.kind,
				count: sql<number>`count(*)::int`,
				amount: sql<number>`coalesce(sum(${ev.amount}), 0)::int`,
				minutes: sql<number>`coalesce(sum(${ev.minutes}), 0)::int`
			})
			.from(ev)
			.groupBy(ev.type, ev.kind),
		db
			.select({
				month: sql<number>`extract(month from ${ev.local})::int`,
				minutes: sql<number>`coalesce(sum(${ev.minutes}), 0)::int`,
				count: sql<number>`(count(*) filter (where ${isCompleted}))::int`
			})
			.from(ev)
			.groupBy(sql`1`),
		// Best scored first, then the latest
		db
			.select({
				mediaId: ev.mediaId,
				title: ev.title,
				type: ev.type,
				posterUrl: ev.posterUrl,
				score: ev.score
			})
			.from(ev)
			.where(isCompleted)
			.groupBy(ev.mediaId, ev.title, ev.type, ev.posterUrl, ev.score)
			.orderBy(sql`${ev.score} desc nulls last`, desc(sql`max(${ev.local})`))
			.limit(5),
		db
			.select({ name: genres.name, count: sql<number>`count(distinct ${ev.mediaId})::int` })
			.from(ev)
			.innerJoin(mediaGenres, eq(mediaGenres.mediaId, ev.mediaId))
			.innerJoin(genres, eq(genres.id, mediaGenres.genreId))
			.where(isCompleted)
			.groupBy(genres.name)
			.orderBy(desc(sql`2`), genres.name)
			.limit(1),
		// Habits from what was logged live: imports carry a made-up time of day
		db
			.select({
				tracked: sql<number>`count(*)::int`,
				night: sql<number>`(count(*) filter (where extract(hour from ${ev.local}) >= 22 or extract(hour from ${ev.local}) < 5))::int`,
				days: sql<number>`count(distinct ${ev.local}::date)::int`
			})
			.from(ev)
			.where(ne(ev.source, 'import')),
		// Posters of the year's completions, latest first (the page's opening wall)
		db
			.select({ mediaId: ev.mediaId, title: ev.title, posterUrl: ev.posterUrl })
			.from(ev)
			.where(and(isCompleted, sql`${ev.posterUrl} is not null`))
			.groupBy(ev.mediaId, ev.title, ev.posterUrl)
			.orderBy(desc(sql`max(${ev.local})`))
			.limit(RECAP_WALL),
		// The year's perfect scores (5/5 in every scale), latest first, with their full count
		db
			.select({
				mediaId: ev.mediaId,
				title: ev.title,
				posterUrl: ev.posterUrl,
				total: sql<number>`(count(*) over ())::int`
			})
			.from(ev)
			.where(and(isCompleted, eq(ev.score, 100)))
			.groupBy(ev.mediaId, ev.title, ev.posterUrl)
			.orderBy(desc(sql`max(${ev.local})`))
			.limit(RECAP_FAVORITES)
	]);

	const minutes = zeros();
	const completed = zeros();
	const units = { episode: 0, chapter: 0, pages: 0 };
	for (const r of totals) {
		minutes[r.type] += r.minutes;
		if (r.kind === 'completed') completed[r.type] += r.count;
		if (r.kind === 'episode' || r.kind === 'chapter' || r.kind === 'pages')
			units[r.kind] += r.amount;
	}
	const busiest = [...months].sort((a, b) => b.minutes - a.minutes || b.count - a.count)[0];
	const tracked = habits?.tracked ?? 0;
	const nightShare = tracked ? habits.night / tracked : 0;
	return {
		year,
		minutes,
		hours: Math.round(MEDIA_TYPES.reduce((n, t) => n + minutes[t], 0) / 60),
		completed,
		units,
		busiestMonth: busiest && (busiest.minutes || busiest.count) ? busiest.month : null,
		/** Hours per month, January first */
		perMonth: Array.from({ length: 12 }, (_, i) =>
			Math.round((months.find((m) => m.month === i + 1)?.minutes ?? 0) / 60)
		),
		genre: genre?.name ?? null,
		activeDays: habits?.days ?? 0,
		top,
		wall: wall as { mediaId: number; title: string; posterUrl: string }[],
		/** Perfect scores of the year (at most `RECAP_FAVORITES` posters) and how many there are */
		favorites: favorites.map((f) => ({
			mediaId: f.mediaId,
			title: f.title,
			posterUrl: f.posterUrl
		})),
		favoritesCount: favorites[0]?.total ?? 0,
		personality: personality({ completed, minutes, nightShare, tracked })
	};
}

export type YearRecap = Awaited<ReturnType<typeof yearRecap>>;

/** Days before the release, rounded up (0 once open). */
export const daysToRelease = (now = new Date()) =>
	Math.max(0, Math.ceil((RECAP_RELEASE.getTime() - now.getTime()) / 86_400_000));

/** "1er décembre": the release day as the pages and cards say it. */
export function releaseLabel(d = RECAP_RELEASE) {
	const [day, month] = new Intl.DateTimeFormat('fr-FR', {
		timeZone: TIMEZONE,
		day: 'numeric',
		month: 'long'
	})
		.format(d)
		.split(' ');
	return `${day === '1' ? '1er' : day} ${month}`;
}
