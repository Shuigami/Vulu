// Upcoming episodes of the shows and anime a user follows.
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { Db } from './db';
import { episodes, libraryEntries, media, seasons } from './db/schema';

// shortcut: one timezone for everyone (French audience in V1); add users.timezone when needed.
export const TIMEZONE = 'Europe/Paris';

/** Statuses that count as "followed" for the calendar. */
const FOLLOWED = ['planned', 'in_progress', 'paused'] as const;

export function upcomingEpisodes(db: Db, userId: string, from: Date, to: Date) {
	return db
		.select({
			airDate: episodes.airDate,
			number: episodes.number,
			title: episodes.title,
			seasonNumber: seasons.number,
			mediaId: media.id,
			mediaTitle: media.title,
			type: media.type,
			posterUrl: media.posterUrl
		})
		.from(episodes)
		.innerJoin(media, eq(media.id, episodes.mediaId))
		.innerJoin(
			libraryEntries,
			and(
				eq(libraryEntries.mediaId, media.id),
				eq(libraryEntries.userId, userId),
				inArray(libraryEntries.status, [...FOLLOWED])
			)
		)
		.leftJoin(seasons, eq(seasons.id, episodes.seasonId))
		.where(and(gte(episodes.airDate, from), lt(episodes.airDate, to)))
		.orderBy(asc(episodes.airDate), asc(media.title), asc(episodes.number));
}

/** Next episode of a media airing from `from` on, or undefined. */
export async function nextEpisode(db: Db, mediaId: number, from: Date) {
	const [next] = await db
		.select({ airDate: episodes.airDate, number: episodes.number, seasonNumber: seasons.number })
		.from(episodes)
		.leftJoin(seasons, eq(seasons.id, episodes.seasonId))
		.where(and(eq(episodes.mediaId, mediaId), gte(episodes.airDate, from)))
		.orderBy(asc(episodes.airDate))
		.limit(1);
	return next;
}

/** Midnight today in TIMEZONE, as an instant. */
export function startOfToday(now = new Date()): Date {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: TIMEZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(now);
	const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
	// Time elapsed since local midnight, subtracted from now
	const sinceMidnight = (get('hour') * 3600 + get('minute') * 60 + get('second')) * 1000;
	return new Date(now.getTime() - (now.getTime() % 1000) - sinceMidnight);
}

const dayFormat = new Intl.DateTimeFormat('fr-FR', {
	timeZone: TIMEZONE,
	weekday: 'long',
	day: 'numeric',
	month: 'long'
});
const dayKeyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE });
const weekdayFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: TIMEZONE, weekday: 'short' });
const dayNumberFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: TIMEZONE, day: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('fr-FR', {
	timeZone: TIMEZONE,
	hour: '2-digit',
	minute: '2-digit'
});

/** TMDB only gives a date (stored at 00:00 UTC); AniList gives the exact airing time. */
const hasTime = (d: Date) => d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0;

/** Formats dates on the server, so the page does not depend on the browser's timezone. */
export function describeAirDate(d: Date) {
	return {
		dayKey: dayKeyFormat.format(d),
		day: dayFormat.format(d),
		weekday: weekdayFormat.format(d),
		dayNumber: dayNumberFormat.format(d),
		time: hasTime(d) ? timeFormat.format(d) : null
	};
}

/** "S2E3" for seasons, "Ép. 12" for anime, "Spécial 1" for season 0. */
export function episodeLabel(e: { seasonNumber: number | null; number: number }) {
	if (e.seasonNumber === null) return `Ép. ${e.number}`;
	if (e.seasonNumber === 0) return `Spécial ${e.number}`;
	return `S${e.seasonNumber}E${e.number}`;
}

/** "2026-11" for the current month in TIMEZONE. */
export const currentMonth = (now = new Date()) => dayKeyFormat.format(now).slice(0, 7);

/** "2026-11" moved by `delta` months. */
export function shiftMonth(month: string, delta: number) {
	const [y, m] = month.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** Local midnights (TIMEZONE) bounding the month, as instants. */
export function monthRange(month: string) {
	const [y, m] = month.split('-').map(Number);
	// Noon UTC is the same calendar day in Paris, so startOfToday gives its local midnight.
	return {
		from: startOfToday(new Date(Date.UTC(y, m - 1, 1, 12))),
		to: startOfToday(new Date(Date.UTC(y, m, 1, 12)))
	};
}

/** Weeks of the month, Monday first, padded with the neighbouring months' days. */
export function monthGrid(month: string) {
	const [y, m] = month.split('-').map(Number);
	const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
	const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
	return Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => {
		const d = new Date(Date.UTC(y, m - 1, 1 + i - lead, 12));
		return {
			key: d.toISOString().slice(0, 10),
			day: d.getUTCDate(),
			inMonth: i >= lead && i < lead + days,
			label: dayFormat.format(d)
		};
	});
}

const monthFormat = new Intl.DateTimeFormat('fr-FR', {
	timeZone: 'UTC',
	month: 'long',
	year: 'numeric'
});
export const monthLabel = (month: string) => monthFormat.format(new Date(`${month}-15T12:00:00Z`));

const shortDateFormat = new Intl.DateTimeFormat('fr-FR', {
	timeZone: TIMEZONE,
	day: 'numeric',
	month: 'short'
});

/** "à l’instant", "il y a 3 h", "hier", "il y a 4 j", then "12 nov." (activity feeds). */
export function timeAgo(d: Date, now = new Date()) {
	const minutes = Math.floor((now.getTime() - d.getTime()) / 60_000);
	if (minutes < 1) return 'à l’instant';
	if (minutes < 60) return `il y a ${minutes} min`;
	if (minutes < 24 * 60) return `il y a ${Math.floor(minutes / 60)} h`;
	const days = Math.round((startOfToday(now).getTime() - startOfToday(d).getTime()) / 86_400_000);
	if (days <= 1) return 'hier';
	if (days < 7) return `il y a ${days} j`;
	return shortDateFormat.format(d);
}
