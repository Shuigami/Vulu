// Episodes by season and per-episode tracking (TV shows). Progress stays the single counter
// of library_entries: marking an episode means "seen up to here" (its absolute number).
// episode_views only add dates, and track specials, which have no absolute number.
import { and, asc, eq, gt, gte, inArray, lte, max, or, sql } from 'drizzle-orm';
import type { Db } from './db';
import { episodes, episodeViews, libraryEntries, seasons } from './db/schema';
import { addToLibrary, updateEntry } from './library';
import { shortDate } from './calendar';

type Entry = { progress: number; startedOn: string | null } | null;

/** Views of the current run only: a rewatch starts over (startedOn is reset). */
const sinceRun = (startedOn: string | null) =>
	startedOn ? gte(episodeViews.viewedAt, new Date(`${startedOn}T00:00:00Z`)) : undefined;

/** Seasons (specials last) with their episodes and, for a viewer with an entry, what they saw. */
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
			seenAt: max(episodeViews.viewedAt)
		})
		.from(episodes)
		.innerJoin(seasons, eq(seasons.id, episodes.seasonId))
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

	const now = Date.now();
	const progress = entry?.progress ?? 0;
	const list: {
		id: number;
		number: number;
		title: string | null;
		episodes: {
			id: number;
			number: number;
			absolute: number | null;
			title: string | null;
			airDate: string | null;
			aired: boolean;
			seen: boolean;
			seenOn: string | null;
		}[];
	}[] = [];
	for (const r of rows) {
		let s = list.at(-1);
		if (s?.id !== r.seasonId)
			list.push((s = { id: r.seasonId, number: r.season, title: r.seasonTitle, episodes: [] }));
		s.episodes.push({
			id: r.id,
			number: r.number,
			absolute: r.absolute,
			title: r.title,
			airDate: r.airDate && shortDate(r.airDate),
			aired: !r.airDate || r.airDate.getTime() <= now,
			// Numbered episodes follow the counter; specials only have their views
			seen: !!entry && (r.absolute ? r.absolute <= progress : !!r.seenAt),
			seenOn: r.seenAt && shortDate(r.seenAt)
		});
	}
	return list;
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

/** Marks every aired episode of a season seen (specials: each one gets a view). */
export async function markSeason(db: Db, userId: string, mediaId: number, seasonId: number) {
	const aired = await db
		.select({ id: episodes.id, absolute: episodes.absoluteNumber })
		.from(episodes)
		.where(
			and(
				eq(episodes.mediaId, mediaId),
				eq(episodes.seasonId, seasonId),
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
