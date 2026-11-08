import { db } from '#lib/server/app.ts';
import {
	currentMonth,
	describeAirDate,
	episodeLabel,
	monthGrid,
	monthLabel,
	monthRange,
	shiftMonth,
	startOfToday,
	upcomingEpisodes
} from '#lib/server/calendar.ts';
import type { PageServerLoad } from './$types';

const DAYS = 30;

type Row = Awaited<ReturnType<typeof upcomingEpisodes>>[number];

function toItem(r: Row) {
	const { dayKey, day, time } = describeAirDate(r.airDate!);
	return {
		dayKey,
		day,
		key: `${r.mediaId}:${r.seasonNumber}:${r.number}`,
		time,
		episode: episodeLabel(r),
		episodeTitle: r.title,
		mediaId: r.mediaId,
		mediaTitle: r.mediaTitle,
		type: r.type,
		posterUrl: r.posterUrl
	};
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const today = describeAirDate(new Date()).dayKey;

	if (url.searchParams.get('view') === 'month') {
		const param = url.searchParams.get('month');
		const month = param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param) ? param : currentMonth();
		const { from, to } = monthRange(month);
		const items = (await upcomingEpisodes(db, locals.user!.id, from, to)).map(toItem);
		return {
			view: 'month' as const,
			today,
			month,
			title: monthLabel(month),
			prev: shiftMonth(month, -1),
			next: shiftMonth(month, 1),
			isCurrent: month === currentMonth(),
			cells: monthGrid(month).map((c) => ({
				...c,
				items: c.inMonth ? items.filter((i) => i.dayKey === c.key) : []
			}))
		};
	}

	const from = startOfToday();
	const to = new Date(from.getTime() + DAYS * 24 * 3600 * 1000);
	const days: { key: string; label: string; items: ReturnType<typeof toItem>[] }[] = [];
	for (const item of (await upcomingEpisodes(db, locals.user!.id, from, to)).map(toItem)) {
		if (days.at(-1)?.key !== item.dayKey)
			days.push({ key: item.dayKey, label: item.day, items: [] });
		days.at(-1)!.items.push(item);
	}
	return { view: 'list' as const, today, days, horizon: DAYS };
};
