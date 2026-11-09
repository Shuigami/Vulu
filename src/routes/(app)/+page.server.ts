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
		week: upcoming.map((r) => {
			const { weekday, dayNumber, time } = describeAirDate(r.airDate!);
			return {
				key: `${r.mediaId}:${r.seasonNumber}:${r.number}`,
				weekday,
				dayNumber,
				time,
				episode: episodeLabel(r),
				mediaId: r.mediaId,
				mediaTitle: r.mediaTitle
			};
		})
	};
};

export const actions: Actions = {
	increment: async ({ request, locals }) => {
		const entryId = Number((await request.formData()).get('entryId'));
		if (!(await incrementProgress(db, locals.user!.id, entryId))) error(404, 'Entrée introuvable');
	}
};
