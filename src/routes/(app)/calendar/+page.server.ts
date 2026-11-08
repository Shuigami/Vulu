import { db } from '#lib/server/app.ts';
import {
	describeAirDate,
	episodeLabel,
	startOfToday,
	upcomingEpisodes
} from '#lib/server/calendar.ts';
import type { PageServerLoad } from './$types';

const DAYS = 30;

export const load: PageServerLoad = async ({ locals }) => {
	const from = startOfToday();
	const to = new Date(from.getTime() + DAYS * 24 * 3600 * 1000);
	const rows = await upcomingEpisodes(db, locals.user!.id, from, to);

	const days: { key: string; label: string; items: CalendarItem[] }[] = [];
	for (const r of rows) {
		const { dayKey, day, time } = describeAirDate(r.airDate!);
		if (days.at(-1)?.key !== dayKey) days.push({ key: dayKey, label: day, items: [] });
		days.at(-1)!.items.push({
			key: `${r.mediaId}:${r.seasonNumber}:${r.number}`,
			time,
			episode: episodeLabel(r),
			episodeTitle: r.title,
			mediaId: r.mediaId,
			mediaTitle: r.mediaTitle,
			type: r.type,
			posterUrl: r.posterUrl
		});
	}
	return { days, horizon: DAYS };
};

type CalendarItem = {
	key: string;
	time: string | null;
	episode: string;
	episodeTitle: string | null;
	mediaId: number;
	mediaTitle: string;
	type: 'movie' | 'tv' | 'anime' | 'manga' | 'book';
	posterUrl: string | null;
};
