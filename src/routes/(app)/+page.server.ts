import { error, fail } from '@sveltejs/kit';
import { db, getBoss } from '#lib/server/app.ts';
import { ANONYMOUS_ID, requireUser } from '#lib/server/guard.ts';
import {
	describeAirDate,
	episodeLabel,
	startOfToday,
	upcomingEpisodes
} from '#lib/server/calendar.ts';
import { isEntryStatus, MEDIA_TYPES } from '#lib/labels.ts';
import {
	popularOnVulu,
	recommendations,
	trending,
	type DiscoverItem
} from '#lib/server/discover.ts';
import { seasonRanges, withSeasons } from '#lib/server/episodes.ts';
import { seasonAt, type SeasonRange } from '#lib/seasons.ts';
import {
	changeStatus,
	incrementProgress,
	listEntries,
	undoStatus,
	type StatusUndo
} from '#lib/server/library.ts';
import { feed, feedView } from '#lib/server/social.ts';
import {
	daysToRelease,
	RECAP_BANNER_END,
	RECAP_YEAR,
	recapOpen,
	releaseLabel
} from '#lib/server/recap.ts';
import type { Actions, PageServerLoad } from './$types';

const WEEK = 7 * 24 * 3600 * 1000;

const isDay = (v: unknown) =>
	v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v));

/** The `undo` field posted back by "Annuler" (what the status action returned), or null. */
function parseUndo(raw: FormDataEntryValue | null): StatusUndo | null {
	try {
		const u = JSON.parse(String(raw));
		const ids = (v: unknown) =>
			Array.isArray(v) && v.length <= 10 && v.every((n) => Number.isSafeInteger(n));
		if (
			isEntryStatus(u?.status) &&
			Number.isSafeInteger(u.progress) &&
			u.progress >= 0 &&
			isDay(u.startedOn) &&
			isDay(u.completedOn) &&
			ids(u.events)
		)
			return {
				status: u.status,
				progress: u.progress,
				startedOn: u.startedOn,
				completedOn: u.completedOn,
				events: u.events
			};
	} catch {
		// Not JSON
	}
	return null;
}

const countdown = (days: number) =>
	days <= 0 ? 'Aujourd’hui' : days === 1 ? 'Demain' : `Dans ${Math.round(days)} j`;

/**
 * Series: the season of the first episode coming out, with what was seen of it and the release
 * as a segment of that season (for the progress bar).
 */
function weekSeason(ranges: SeasonRange[], release: [number, number], progress: number) {
	const at = seasonAt(ranges, release[0], progress);
	if (!at) return null;
	const n = (absolute: number) => Math.min(at.count, absolute - at.first + 1);
	return {
		number: at.season,
		seen: at.seen,
		count: at.count,
		release: [n(release[0]), n(release[1])] as [number, number]
	};
}

/** One tile per work and day: a season dropped at once shows as "S3E1 à S3E4", not four tiles. */
function groupWeek({
	rows,
	ranges
}: {
	rows: Awaited<ReturnType<typeof upcomingEpisodes>>;
	ranges: Awaited<ReturnType<typeof seasonRanges>>;
}) {
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
		season: weekSeason(ranges.get(t.mediaId) ?? [], t.release, t.progress),
		episode: episodes.length > 1 ? `${episodes[0]} à ${episodes.at(-1)}` : episodes[0],
		count: episodes.length,
		countdown: countdown((Date.parse(t.key.split(':')[1]) - today) / 86_400_000)
	}));
}

export const load: PageServerLoad = async ({ locals }) => {
	// Signed-out visitors only get the discovery shelves
	const userId = locals.user?.id;
	const from = startOfToday();
	const [entries, upcoming, friends, popular] = await Promise.all([
		userId
			? listEntries(db, userId, { status: 'in_progress' }).then((r) => withSeasons(db, r))
			: [],
		userId
			? upcomingEpisodes(db, userId, from, new Date(from.getTime() + WEEK)).then(async (rows) => ({
					rows,
					ranges: await seasonRanges(
						db,
						rows.map((r) => r.mediaId)
					)
				}))
			: { rows: [], ranges: new Map() },
		userId ? feed(db, { viewerId: userId, limit: 12 }) : { items: [] },
		popularOnVulu(db, userId ?? ANONYMOUS_ID)
	]);
	// Streamed: provider lists come from the worker (cached a day) and never block the page
	const quiet = <T>(p: Promise<T>) =>
		p.catch((err) => {
			console.error('[home] provider discovery unavailable', err);
			return null;
		});
	const boss = getBoss();
	const now = new Date();
	return {
		// Teaser until the release, then a link to one's recap, until the banner's end date
		recap:
			userId && now < RECAP_BANNER_END
				? {
						year: RECAP_YEAR,
						open: recapOpen(now),
						days: daysToRelease(now),
						release: releaseLabel()
					}
				: null,
		friends: feedView(friends.items).slice(0, 8),
		popular,
		// One promise per type, each streamed on its own: the shown type does not wait for the others
		trending: Object.fromEntries(
			MEDIA_TYPES.map((type) => [type, quiet(boss.then((b) => trending(db, b, type)))])
		) as Record<(typeof MEDIA_TYPES)[number], Promise<DiscoverItem[] | null>>,
		discoveries: userId
			? quiet(boss.then((b) => recommendations(db, b, userId)))
			: Promise.resolve(null),

		entries,
		week: groupWeek(upcoming)
	};
};

export const actions: Actions = {
	increment: async ({ request, locals, url }) => {
		const entryId = Number((await request.formData()).get('entryId'));
		if (!(await incrementProgress(db, requireUser(locals, url).id, entryId)))
			error(404, 'Entrée introuvable');
	},
	// Long press menu on a "Reprendre" card
	status: async ({ request, locals, url }) => {
		const userId = requireUser(locals, url).id;
		const form = await request.formData();
		const status = form.get('status');
		if (!isEntryStatus(status)) return fail(400, { message: 'Statut invalide.' });
		const undo = await changeStatus(db, userId, Number(form.get('entryId')), status);
		if (!undo) error(404, 'Entrée introuvable');
		return { undo };
	},
	undoStatus: async ({ request, locals, url }) => {
		const userId = requireUser(locals, url).id;
		const form = await request.formData();
		const undo = parseUndo(form.get('undo'));
		if (!undo) return fail(400, { message: 'Annulation invalide.' });
		if (!(await undoStatus(db, userId, Number(form.get('entryId')), undo)))
			error(404, 'Entrée introuvable');
	}
};
