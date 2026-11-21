// Anime franchises (docs/franchises-anime.md): works that existed per AniList season before
// franchises are merged into the franchise, with their library entries, journal, lists,
// episode views and scores. Runs in the worker, after the franchise's episodes are synced.
import { and, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from './db';
import {
	episodes,
	libraryEntries,
	listItems,
	media,
	mediaExternalIds,
	mediaTitles,
	seasons
} from './db/schema';

type Entry = typeof libraryEntries.$inferSelect;
type Merged = Pick<
	Entry,
	| 'status'
	| 'score'
	| 'progress'
	| 'progressSecondary'
	| 'repeatCount'
	| 'startedOn'
	| 'completedOn'
	| 'review'
	| 'notes'
	| 'isFavorite'
	| 'isPrivate'
>;

/** One season's entry of a user: its season, where the season starts and how long it is. */
export type SeasonEntry = {
	season: number;
	offset: number;
	count: number;
	entry: Omit<Merged, 'progressSecondary'>;
};

/**
 * One franchise entry from a user's season entries. `aired` is the franchise's aired episode
 * count, `total` all its numbered episodes, `seasonEnds` the last absolute number of each season.
 */
export function mergeEntries(
	parts: SeasonEntry[],
	franchise: { aired: number; total: number; seasonEnds: number[] }
): Merged {
	const bySeason = [...parts].sort((a, b) => b.season - a.season); // latest first
	const started = bySeason.filter((p) => p.entry.status !== 'planned' || p.entry.progress > 0);
	// "Seen up to here": a season skipped before the last one started counts as seen
	const reached = started.map(
		(p) =>
			p.offset +
			(p.entry.status === 'completed' ? Math.max(p.count, p.entry.progress) : p.entry.progress)
	);
	const progress = Math.min(Math.max(0, ...reached), franchise.total || Infinity);
	const last = started[0];
	const status: Merged['status'] = !last
		? 'planned'
		: franchise.aired && progress >= franchise.aired
			? 'completed'
			: last.entry.status === 'completed'
				? 'in_progress' // a later season is out
				: last.entry.status;

	// One score: the latest season rated; the others are kept in the notes
	const rated = bySeason.filter((p) => p.entry.score !== null);
	const many = parts.length > 1;
	const label = (p: SeasonEntry) => `Saison ${p.season}`;
	const texts = (key: 'review' | 'notes') =>
		[...parts]
			.sort((a, b) => a.season - b.season)
			.filter((p) => p.entry[key])
			.map((p) => (many ? `${label(p)} :\n${p.entry[key]}` : p.entry[key]!));
	const otherScores = rated
		.slice(1)
		.reverse()
		.map((p) => `${label(p)} : ${p.entry.score}/100`);
	const join = (lines: string[]) => (lines.length ? lines.join('\n\n') : null);
	const dates = (key: 'startedOn' | 'completedOn') =>
		parts
			.map((p) => p.entry[key])
			.filter((d): d is string => !!d)
			.sort();

	return {
		status,
		score: rated[0]?.entry.score ?? null,
		progress,
		progressSecondary: franchise.seasonEnds.filter((end) => end <= progress).length,
		repeatCount: Math.max(0, ...parts.map((p) => p.entry.repeatCount)),
		startedOn: dates('startedOn')[0] ?? null,
		completedOn: status === 'completed' ? (dates('completedOn').at(-1) ?? null) : null,
		review: join(texts('review')),
		notes: join([...texts('notes'), ...(otherScores.length ? [otherScores.join('\n')] : [])]),
		isFavorite: parts.some((p) => p.entry.isFavorite),
		isPrivate: parts.some((p) => p.entry.isPrivate)
	};
}

/**
 * Merges into a franchise the works whose primary AniList id is one of its seasons, and moves
 * episodes it had without season (before franchises) to its season 1. Idempotent; returns the
 * number of works merged.
 */
export async function mergeSeasons(db: Db, franchiseId: number): Promise<number> {
	const list = await db
		.select({ id: seasons.id, number: seasons.number, anilistId: seasons.anilistId })
		.from(seasons)
		.where(and(eq(seasons.mediaId, franchiseId), isNotNull(seasons.anilistId)));
	if (!list.length) return 0;
	const orphans = await db
		.select({ mediaId: mediaExternalIds.mediaId, seasonId: seasons.id, number: seasons.number })
		.from(mediaExternalIds)
		.innerJoin(
			seasons,
			and(eq(seasons.anilistId, mediaExternalIds.externalId), eq(seasons.mediaId, franchiseId))
		)
		.where(
			and(
				eq(mediaExternalIds.provider, 'anilist'),
				eq(mediaExternalIds.isPrimary, true),
				ne(mediaExternalIds.mediaId, franchiseId)
			)
		);
	const [{ loose }] = await db
		.select({ loose: sql<number>`count(*)::int` })
		.from(episodes)
		.where(and(eq(episodes.mediaId, franchiseId), isNull(episodes.seasonId)));
	if (!orphans.length && !loose) return 0;

	const first = list.find((s) => s.number === 1);
	return db.transaction(async (tx) => {
		// Serializes with imports of the same franchise (upsertMedia takes the same lock)
		const [root] = await tx
			.select({ externalId: mediaExternalIds.externalId })
			.from(mediaExternalIds)
			.where(and(eq(mediaExternalIds.mediaId, franchiseId), eq(mediaExternalIds.isPrimary, true)));
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`anilist:${root.externalId}`}))`);

		// Episodes by season: where each starts, how long it is, what has aired
		const stats = await tx
			.select({
				seasonId: episodes.seasonId,
				first: sql<number>`min(${episodes.absoluteNumber})::int`,
				last: sql<number>`max(${episodes.absoluteNumber})::int`,
				count: sql<number>`count(${episodes.absoluteNumber})::int`,
				aired: sql<number>`count(${episodes.absoluteNumber}) filter (where ${episodes.airDate} is null or ${episodes.airDate} <= now())::int`
			})
			.from(episodes)
			.where(and(eq(episodes.mediaId, franchiseId), isNotNull(episodes.seasonId)))
			.groupBy(episodes.seasonId);
		const bySeason = new Map(stats.map((s) => [s.seasonId!, s]));
		const franchise = {
			aired: stats.reduce((n, s) => n + s.aired, 0),
			total: stats.reduce((n, s) => n + s.count, 0),
			seasonEnds: stats.map((s) => s.last)
		};

		// Library entries: one per user, merged from the franchise's own (season 1) and the orphans'
		const sources = [
			...(first ? [{ mediaId: franchiseId, seasonId: first.id, number: 1 }] : []),
			...orphans
		];
		const entries = await tx
			.select()
			.from(libraryEntries)
			.where(
				inArray(
					libraryEntries.mediaId,
					sources.map((s) => s.mediaId)
				)
			);
		const byUser = Map.groupBy(entries, (e) => e.userId);
		for (const userEntries of byUser.values()) {
			const parts = userEntries.map((entry) => {
				const source = sources.find((s) => s.mediaId === entry.mediaId)!;
				const s = bySeason.get(source.seasonId);
				return {
					season: source.number,
					// shortcut: a season without synced episodes starts at 0; resync then rerun if it shows up
					offset: s ? s.first - 1 : 0,
					count: s?.count ?? 0,
					entry,
					id: entry.id
				};
			});
			const keep =
				parts.find((p) => p.entry.mediaId === franchiseId) ??
				parts.reduce((a, b) => (b.season > a.season ? b : a));
			await tx.delete(libraryEntries).where(
				inArray(
					libraryEntries.id,
					parts.filter((p) => p !== keep).map((p) => p.id)
				)
			);
			// Written directly, not through updateEntry: a merge is not something the user did,
			// so it logs nothing (the journal of each season moves below)
			await tx
				.update(libraryEntries)
				.set({ mediaId: franchiseId, ...mergeEntries(parts, franchise) })
				.where(eq(libraryEntries.id, keep.id));
		}

		// Episodes without season: the franchise's own (season 1) and the orphans' (their season)
		const moves = [
			...(first && loose ? [{ mediaId: franchiseId, seasonId: first.id }] : []),
			...orphans
		];
		for (const { mediaId, seasonId } of moves) {
			// The same episode number in its franchise season
			const same = (join = sql``) => sql`from ${episodes} o
				join ${episodes} n on n.media_id = ${franchiseId} and n.season_id = ${seasonId} and n.number = o.number
				${join} where o.media_id = ${mediaId} and o.season_id is null`;
			await tx.execute(sql`insert into episode_views (user_id, episode_id, viewed_at)
				select v.user_id, n.id, v.viewed_at ${same(sql`join episode_views v on v.episode_id = o.id`)}
				on conflict do nothing`);
			await tx.execute(sql`insert into episode_ratings (user_id, episode_id, score, rated_at)
				select r.user_id, n.id, r.score, r.rated_at ${same(sql`join episode_ratings r on r.episode_id = o.id`)}
				on conflict do nothing`);
			// The orphan's whole journal moves; the franchise's own only where it names such an episode
			await tx.execute(sql`update activity_events a set media_id = ${franchiseId},
				episode_id = coalesce((select n.id ${same()} and o.id = a.episode_id), a.episode_id)
				where a.media_id = ${mediaId}${
					mediaId === franchiseId
						? sql` and a.episode_id in (select id from episodes where media_id = ${mediaId} and season_id is null)`
						: sql``
				}`);
		}
		await tx
			.delete(episodes)
			.where(and(eq(episodes.mediaId, franchiseId), isNull(episodes.seasonId)));

		for (const { mediaId } of orphans) {
			await tx.execute(sql`insert into ${listItems} (list_id, media_id, position, note, added_at)
				select list_id, ${franchiseId}, position, note, added_at from ${listItems}
				where media_id = ${mediaId} on conflict do nothing`);
			await tx.execute(sql`insert into ${mediaTitles} (media_id, title, locale)
				select ${franchiseId}, title, locale from ${mediaTitles}
				where media_id = ${mediaId} on conflict do nothing`);
			await tx
				.update(mediaExternalIds)
				.set({ mediaId: franchiseId, isPrimary: false })
				.where(eq(mediaExternalIds.mediaId, mediaId));
			await tx.delete(media).where(eq(media.id, mediaId));
		}
		return orphans.length;
	});
}

/** Anime series still stored as one work per AniList season: the first pass after deploying. */
export async function animeToGroup(db: Db): Promise<number[]> {
	const rows = await db
		.select({ id: media.id })
		.from(media)
		.innerJoin(
			mediaExternalIds,
			and(
				eq(mediaExternalIds.mediaId, media.id),
				eq(mediaExternalIds.isPrimary, true),
				eq(mediaExternalIds.provider, 'anilist')
			)
		)
		.where(
			and(
				eq(media.type, 'anime'),
				sql`${media.extra}->>'format' in ('TV', 'TV_SHORT', 'ONA')`,
				sql`not exists (select 1 from ${seasons} where ${seasons.mediaId} = ${media.id}
					and ${seasons.anilistId} is not null)`
			)
		);
	return rows.map((r) => r.id);
}
