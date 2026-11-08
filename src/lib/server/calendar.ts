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
		time: hasTime(d) ? timeFormat.format(d) : null
	};
}

/** "S2E3" for seasons, "Ép. 12" for anime, "Spécial 1" for season 0. */
export function episodeLabel(e: { seasonNumber: number | null; number: number }) {
	if (e.seasonNumber === null) return `Ép. ${e.number}`;
	if (e.seasonNumber === 0) return `Spécial ${e.number}`;
	return `S${e.seasonNumber}E${e.number}`;
}
