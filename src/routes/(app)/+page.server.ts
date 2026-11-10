import { error } from '@sveltejs/kit';
import { db, getBoss } from '#lib/server/app.ts';
import {
	describeAirDate,
	episodeLabel,
	startOfToday,
	upcomingEpisodes
} from '#lib/server/calendar.ts';
import { popularOnVulu, recommendations, trending } from '#lib/server/discover.ts';
import { incrementProgress, listEntries } from '#lib/server/library.ts';
import { feed, feedView } from '#lib/server/social.ts';
import type { Actions, PageServerLoad } from './$types';

const WEEK = 7 * 24 * 3600 * 1000;

const countdown = (days: number) =>
	days <= 0 ? 'Aujourd’hui' : days === 1 ? 'Demain' : `Dans ${Math.round(days)} j`;

/** One tile per work and day: a season dropped at once shows as "S3E1 à S3E4", not four tiles. */
function groupWeek(rows: Awaited<ReturnType<typeof upcomingEpisodes>>) {
	const tiles = new Map<
		string,
		{
			key: string;
			weekday: string;
			dayNumber: string;
			time: string | null;
			episodes: string[];
			/** First and last airing episode, counted across seasons (for the progress bar). */
			release: [number, number];
			mediaId: number;
			mediaTitle: string;
			posterUrl: string | null;
			progress: number;
			totalUnits: number | null;
		}
	>();
	const today = Date.parse(describeAirDate(new Date()).dayKey);
	for (const r of rows) {
		const { dayKey, weekday, dayNumber, time } = describeAirDate(r.airDate!);
		const key = `${r.mediaId}:${dayKey}`;
		const tile = tiles.get(key);
		const n = r.absoluteNumber ?? r.number;
		if (tile) {
			tile.episodes.push(episodeLabel(r));
			tile.release = [Math.min(tile.release[0], n), Math.max(tile.release[1], n)];
		} else
			tiles.set(key, {
				key,
				weekday,
				dayNumber,
				time,
				episodes: [episodeLabel(r)],
				release: [n, n],
				mediaId: r.mediaId,
				mediaTitle: r.mediaTitle,
				posterUrl: r.posterUrl,
				progress: r.progress,
				totalUnits: r.totalUnits
			});
	}
	return [...tiles.values()].map(({ episodes, ...t }) => ({
		...t,
		episode: episodes.length > 1 ? `${episodes[0]} à ${episodes.at(-1)}` : episodes[0],
		count: episodes.length,
		countdown: countdown((Date.parse(t.key.split(':')[1]) - today) / 86_400_000)
	}));
}

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const from = startOfToday();
	const [entries, upcoming, friends, popular] = await Promise.all([
		listEntries(db, userId, { status: 'in_progress' }),
		upcomingEpisodes(db, userId, from, new Date(from.getTime() + WEEK)),
		feed(db, { viewerId: userId, limit: 12 }),
		popularOnVulu(db, userId)
	]);
	// Streamed: provider lists come from the worker (cached a day) and never block the page
	const quiet = <T>(p: Promise<T>) =>
		p.catch((err) => {
			console.error('[home] provider discovery unavailable', err);
			return null;
		});
	const boss = getBoss();
	return {
		friends: feedView(friends.items).slice(0, 8),
		popular,
		trending: quiet(boss.then((b) => trending(db, b))),
		discoveries: quiet(boss.then((b) => recommendations(db, b, userId))),
		today: describeAirDate(new Date()).day,
		entries,
		week: groupWeek(upcoming)
	};
};

export const actions: Actions = {
	increment: async ({ request, locals }) => {
		const entryId = Number((await request.formData()).get('entryId'));
		if (!(await incrementProgress(db, locals.user!.id, entryId))) error(404, 'Entrée introuvable');
	}
};
