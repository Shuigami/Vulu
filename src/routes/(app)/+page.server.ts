import { error } from '@sveltejs/kit';
import { db } from '#lib/server/app.ts';
import {
	describeAirDate,
	episodeLabel,
	startOfToday,
	upcomingEpisodes
} from '#lib/server/calendar.ts';
import { incrementProgress, listEntries } from '#lib/server/library.ts';
import type { Actions, PageServerLoad } from './$types';

const WEEK = 7 * 24 * 3600 * 1000;

export const load: PageServerLoad = async ({ locals }) => {
	const from = startOfToday();
	const [entries, upcoming] = await Promise.all([
		listEntries(db, locals.user!.id, { status: 'in_progress' }),
		upcomingEpisodes(db, locals.user!.id, from, new Date(from.getTime() + WEEK))
	]);
	return {
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
