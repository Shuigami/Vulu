// Episodes by season and per-episode tracking (TV shows, and anime as one group without season). Progress stays the single counter
// of library_entries: marking an episode means "seen up to here" (its absolute number).
// episode_views only add dates, and track specials, which have no absolute number.
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, max, or, sql } from 'drizzle-orm';
import type { Db } from './db';
import {
	episodeRatings,
	episodes,
	episodeViews,
	libraryEntries,
	seasons,
	users
} from './db/schema';
import { addToLibrary, updateEntry } from './library';
import { episodeLabel, shortDate } from './calendar';
import { visibleTo } from './social';
import type { SeasonRange } from '../seasons';

type Entry = { progress: number; startedOn: string | null } | null;

/** Views of the current run only: a rewatch starts over (startedOn is reset). */
const sinceRun = (startedOn: string | null) =>
	startedOn ? gte(episodeViews.viewedAt, new Date(`${startedOn}T00:00:00Z`)) : undefined;

/**
 * Seasons (specials last) with their episodes and, for a viewer with an entry, what they saw.
 * Anime episodes have no season: they come as one group, id 0 and number null.
 */
export async function seasonList(db: Db, mediaId: number, userId: string, entry: Entry) {
	const rows = await db
		.select({
			seasonId: seasons.id,
			season: seasons.number,
			seasonTitle: seasons.title,
			id: episodes.id,
			number: episodes.number,
			absolute: episodes.absoluteNumber,
			title: episodes.title,
			airDate: episodes.airDate,
			runtime: episodes.runtimeMinutes,
			stillUrl: episodes.stillUrl,
			seenAt: max(episodeViews.viewedAt)
		})
		.from(episodes)
		.leftJoin(seasons, eq(seasons.id, episodes.seasonId))
		.leftJoin(
			episodeViews,
			and(
				eq(episodeViews.episodeId, episodes.id),
				eq(episodeViews.userId, userId),
				sinceRun(entry?.startedOn ?? null)
			)
		)
		.where(eq(episodes.mediaId, mediaId))
		.groupBy(seasons.id, episodes.id)
		.orderBy(sql`${seasons.number} = 0`, asc(seasons.number), asc(episodes.number));
	const averages = new Map(
		(await episodeAverages(db, mediaId, userId)).map((a) => [a.episodeId, a.average])
	);

	const now = Date.now();
	const progress = entry?.progress ?? 0;
	const list: {
		id: number;
		number: number | null;
		title: string | null;
		seen: number;
		episodes: {
			id: number;
			number: number;
			absolute: number | null;
			title: string | null;
			airDate: string | null;
			runtime: number | null;
			stillUrl: string | null;
			aired: boolean;
			seen: boolean;
			seenOn: string | null;
			/** Community average out of 100, visible scores only */
			average: number | null;
		}[];
	}[] = [];
	for (const r of rows) {
		let s = list.at(-1);
		const seasonId = r.seasonId ?? 0;
		if (s?.id !== seasonId)
			list.push(
				(s = { id: seasonId, number: r.season, title: r.seasonTitle, seen: 0, episodes: [] })
			);
		// Numbered episodes follow the counter; specials only have their views
		const seen = !!entry && (r.absolute ? r.absolute <= progress : !!r.seenAt);
		if (seen) s.seen++;
		s.episodes.push({
			id: r.id,
			number: r.number,
			absolute: r.absolute,
			title: r.title,
			airDate: r.airDate && shortDate(r.airDate),
			runtime: r.runtime,
			stillUrl: r.stillUrl,
			aired: !r.airDate || r.airDate.getTime() <= now,
			seen,
			seenOn: r.seenAt && shortDate(r.seenAt),
			average: averages.get(r.id) ?? null
		});
	}
	return list;
}

/**
 * Numbered seasons of each work with the absolute numbers of their first and last episodes, so
 * pages can show a series' progress season by season (`seasonPosition`). One query for a list.
 */
export async function seasonRanges(db: Db, mediaIds: number[]) {
	const ranges = new Map<number, SeasonRange[]>();
	if (!mediaIds.length) return ranges;
	const rows = await db
		.select({
			mediaId: episodes.mediaId,
			season: seasons.number,
			first: sql<number>`min(${episodes.absoluteNumber})::int`,
			last: sql<number>`max(${episodes.absoluteNumber})::int`
		})
		.from(episodes)
		.innerJoin(seasons, eq(seasons.id, episodes.seasonId))
		.where(
			and(
				inArray(episodes.mediaId, [...new Set(mediaIds)]),
				gt(seasons.number, 0),
				sql`${episodes.absoluteNumber} is not null`
			)
		)
		.groupBy(episodes.mediaId, seasons.number)
		.orderBy(asc(sql`min(${episodes.absoluteNumber})`));
	for (const { mediaId, ...r } of rows) {
		const list = ranges.get(mediaId) ?? [];
		list.push(r);
		ranges.set(mediaId, list);
	}
	return ranges;
}

/** Adds each series' season ranges (empty for other types) to library rows. */
export async function withSeasons<T extends { mediaId: number; type: string }>(db: Db, rows: T[]) {
	const series = (r: T) => r.type === 'tv' || r.type === 'anime';
	const ranges = await seasonRanges(
		db,
		rows.filter(series).map((r) => r.mediaId)
	);
	return rows.map((r) => ({ ...r, seasons: (series(r) && ranges.get(r.mediaId)) || [] }));
}

/**
 * Marks an episode seen ("up to here": progress moves to its absolute number, the episodes
 * newly covered get a view) or unseen (progress goes back to the episode before it).
 * Specials are toggled on their own. Adds the work to the library if needed.
 * Returns false when the episode is not one of this media's.
 */
export async function markEpisode(
	db: Db,
	userId: string,
	mediaId: number,
	episodeId: number,
	seen: boolean
): Promise<boolean> {
	const [ep] = await db
		.select({ absolute: episodes.absoluteNumber })
		.from(episodes)
		.where(and(eq(episodes.id, episodeId), eq(episodes.mediaId, mediaId)));
	if (!ep) return false;
	const entryId = await addToLibrary(db, userId, mediaId);
	const [entry] = await db
		.select({ startedOn: libraryEntries.startedOn })
		.from(libraryEntries)
		.where(eq(libraryEntries.id, entryId));
	const run = sinceRun(entry.startedOn);

	if (ep.absolute === null) {
		const views = and(eq(episodeViews.userId, userId), eq(episodeViews.episodeId, episodeId), run);
		if (!seen) await db.delete(episodeViews).where(views);
		else if (!(await db.select().from(episodeViews).where(views).limit(1)).length)
			await db.insert(episodeViews).values({ userId, episodeId });
		return true;
	}

	// Seen never moves progress back (a past season), unseen never moves it forward
	let before = 0;
	let target = 0;
	await updateEntry(
		db,
		userId,
		entryId,
		(current) => {
			before = current.progress;
			target = seen ? Math.max(before, ep.absolute!) : Math.min(before, ep.absolute! - 1);
			return { progress: target };
		},
		{ episodeId }
	);

	const covered = (from: number, to: number) =>
		db
			.select({ id: episodes.id })
			.from(episodes)
			.where(
				and(
					eq(episodes.mediaId, mediaId),
					gt(episodes.absoluteNumber, from),
					lte(episodes.absoluteNumber, to)
				)
			);
	if (target > before) {
		const ids = await covered(before, target);
		if (ids.length)
			await db
				.insert(episodeViews)
				.values(ids.map((e) => ({ userId, episodeId: e.id })))
				.onConflictDoNothing();
	} else if (target < before) {
		await db.delete(episodeViews).where(
			and(
				eq(episodeViews.userId, userId),
				run,
				inArray(
					episodeViews.episodeId,
					db
						.select({ id: episodes.id })
						.from(episodes)
						.where(and(eq(episodes.mediaId, mediaId), gt(episodes.absoluteNumber, target)))
				)
			)
		);
	}
	return true;
}

/** Marks every aired episode of a season (0: anime episodes) seen (specials: each one gets a view). */
export async function markSeason(db: Db, userId: string, mediaId: number, seasonId: number) {
	const aired = await db
		.select({ id: episodes.id, absolute: episodes.absoluteNumber })
		.from(episodes)
		.where(
			and(
				eq(episodes.mediaId, mediaId),
				seasonId ? eq(episodes.seasonId, seasonId) : isNull(episodes.seasonId),
				or(sql`${episodes.airDate} is null`, lte(episodes.airDate, new Date()))
			)
		)
		.orderBy(asc(episodes.number));
	if (!aired.length) return false;
	const last = aired.findLast((e) => e.absolute !== null);
	if (last) return markEpisode(db, userId, mediaId, last.id, true);
	for (const e of aired) await markEpisode(db, userId, mediaId, e.id, true);
	return true;
}

/**
 * One episode for its page: details, previous and next episodes, the viewer's views (every run)
 * and score, and the community scores. Null when the episode is not one of this media's.
 */
export async function episodePage(
	db: Db,
	mediaId: number,
	episodeId: number,
	viewerId: string,
	entry: Entry
) {
	const [ep] = await db
		.select({
			id: episodes.id,
			number: episodes.number,
			title: episodes.title,
			airDate: episodes.airDate,
			runtimeMinutes: episodes.runtimeMinutes,
			overview: episodes.overview,
			stillUrl: episodes.stillUrl,
			seasonId: episodes.seasonId,
			seasonNumber: seasons.number,
			// Episodes synced before overviews and stills were stored: none of them has one
			stale: sql<boolean>`not exists (select 1 from ${episodes} e where e.media_id = ${mediaId}
				and (e.overview is not null or e.still_url is not null))`
		})
		.from(episodes)
		.leftJoin(seasons, eq(seasons.id, episodes.seasonId))
		.where(and(eq(episodes.id, episodeId), eq(episodes.mediaId, mediaId)));
	if (!ep) return null;

	const all = await seasonList(db, mediaId, viewerId, entry);
	const list = all.flatMap((s) =>
		s.episodes.map((e) => ({
			...e,
			label: episodeLabel({ seasonNumber: s.number, number: e.number })
		}))
	);
	const i = list.findIndex((e) => e.id === episodeId);
	const season = all.find((s) => s.id === (ep.seasonId ?? 0));
	const [views, [mine], community] = await Promise.all([
		db
			.select({ viewedAt: episodeViews.viewedAt })
			.from(episodeViews)
			.where(and(eq(episodeViews.userId, viewerId), eq(episodeViews.episodeId, episodeId)))
			.orderBy(desc(episodeViews.viewedAt)),
		db
			.select({ score: episodeRatings.score })
			.from(episodeRatings)
			.where(and(eq(episodeRatings.userId, viewerId), eq(episodeRatings.episodeId, episodeId))),
		episodeRatingSummary(db, episodeId, viewerId)
	]);
	const neighbour = (e: (typeof list)[number] | undefined) =>
		e && {
			id: e.id,
			label: e.label,
			title: e.title,
			stillUrl: e.stillUrl,
			airDate: e.airDate,
			aired: e.aired,
			seen: e.seen,
			seenOn: e.seenOn
		};
	return {
		...ep,
		label: episodeLabel(ep),
		airDate: ep.airDate && shortDate(ep.airDate),
		aired: !ep.airDate || ep.airDate.getTime() <= Date.now(),
		seen: list[i]?.seen ?? views.length > 0,
		seenOn: views.map((v) => shortDate(v.viewedAt)),
		previous: i > 0 ? neighbour(list[i - 1]) : null,
		next: i >= 0 ? neighbour(list[i + 1]) : null,
		myScore: mine?.score ?? null,
		community,
		// The season around it: its episodes for the strip, and where this one sits
		season: season && {
			number: season.number,
			title: season.title,
			seen: season.seen,
			episodes: season.episodes.map((e) => ({
				id: e.id,
				number: e.number,
				title: e.title,
				stillUrl: e.stillUrl,
				seen: e.seen
			}))
		}
	};
}

// Episode scores follow show scores' visibility, through the rater's library entry
const raterEntry = and(
	eq(libraryEntries.userId, episodeRatings.userId),
	eq(libraryEntries.mediaId, episodes.mediaId)
);

/** Average (out of 100) of each episode of a media that has scores `viewerId` can see. */
function episodeAverages(db: Db, mediaId: number, viewerId: string) {
	return db
		.select({
			episodeId: episodeRatings.episodeId,
			average: sql<number>`avg(${episodeRatings.score})::float8`
		})
		.from(episodeRatings)
		.innerJoin(episodes, eq(episodes.id, episodeRatings.episodeId))
		.innerJoin(users, eq(users.id, episodeRatings.userId))
		.innerJoin(libraryEntries, raterEntry)
		.where(and(eq(episodes.mediaId, mediaId), visibleTo(viewerId)))
		.groupBy(episodeRatings.episodeId);
}

/** Count, average (out of 100) and histogram buckets of the episode's scores `viewerId` can see. */
export async function episodeRatingSummary(db: Db, episodeId: number, viewerId: string) {
	const rows = await db
		.select({
			bucket: sql<number>`least(${episodeRatings.score} / 10, 9)::int`,
			count: sql<number>`count(*)::int`,
			sum: sql<number>`sum(${episodeRatings.score})::int`
		})
		.from(episodeRatings)
		.innerJoin(episodes, eq(episodes.id, episodeRatings.episodeId))
		.innerJoin(users, eq(users.id, episodeRatings.userId))
		.innerJoin(libraryEntries, raterEntry)
		.where(and(eq(episodeRatings.episodeId, episodeId), visibleTo(viewerId)))
		.groupBy(sql`1`);
	const buckets = Array<number>(10).fill(0);
	for (const r of rows) buckets[r.bucket] = r.count;
	const count = rows.reduce((n, r) => n + r.count, 0);
	const average = count ? rows.reduce((n, r) => n + r.sum, 0) / count : null;
	return { count, average, buckets };
}

/**
 * Sets (score out of 100) or clears (null) the user's score for an episode. Adds the work to the
 * library, whose entry carries the score's visibility. False when the episode is not this media's.
 */
export async function rateEpisode(
	db: Db,
	userId: string,
	mediaId: number,
	episodeId: number,
	score: number | null
): Promise<boolean> {
	const [ep] = await db
		.select({ id: episodes.id })
		.from(episodes)
		.where(and(eq(episodes.id, episodeId), eq(episodes.mediaId, mediaId)));
	if (!ep) return false;
	const mine = and(eq(episodeRatings.userId, userId), eq(episodeRatings.episodeId, episodeId));
	if (score === null) {
		await db.delete(episodeRatings).where(mine);
		return true;
	}
	await addToLibrary(db, userId, mediaId);
	await db
		.insert(episodeRatings)
		.values({ userId, episodeId, score })
		.onConflictDoUpdate({
			target: [episodeRatings.userId, episodeRatings.episodeId],
			set: { score, ratedAt: new Date() }
		});
	return true;
}
