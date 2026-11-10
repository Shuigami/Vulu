// Social: follows, public profiles and the activity feed of followed users.
import { and, desc, eq, ilike, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { activityVerb } from '../labels';
import { timeAgo } from './calendar';
import type { Db } from './db';
import { activityEvents, follows, libraryEntries, media, users } from './db/schema';

/**
 * Visibility rule for entries and events (needs `users` and `library_entries` in the query):
 * the owner sees everything; others only see non-private profiles and entries not hidden.
 */
export const visibleTo = (viewerId: string) =>
	or(
		eq(users.id, viewerId),
		and(ne(users.profileVisibility, 'private'), eq(libraryEntries.isPrivate, false))
	);

/** Journal events shown in feeds; progress events (episodes, pages) would be noise. */
export const FEED_KINDS = ['started', 'completed', 'rated'] as const;

const publicUser = {
	id: users.id,
	username: users.username,
	displayName: users.displayName,
	avatarUrl: users.avatarUrl
};

/** Follows a non-private user by username; false if not found, private or oneself. */
export async function follow(db: Db, followerId: string, username: string) {
	const [target] = await db
		.select({ id: users.id })
		.from(users)
		.where(and(eq(users.username, username), ne(users.profileVisibility, 'private')));
	if (!target || target.id === followerId) return false;
	await db.insert(follows).values({ followerId, followeeId: target.id }).onConflictDoNothing();
	return true;
}

export async function unfollow(db: Db, followerId: string, username: string) {
	await db
		.delete(follows)
		.where(
			and(
				eq(follows.followerId, followerId),
				eq(
					follows.followeeId,
					sql`(select ${users.id} from ${users} where ${users.username} = ${username})`
				)
			)
		);
}

/** A profile as seen by `viewerId`, or null when it does not exist or is private. */
export async function profileByUsername(db: Db, username: string, viewerId: string) {
	const [user] = await db
		.select({
			...publicUser,
			profileVisibility: users.profileVisibility,
			createdAt: users.createdAt
		})
		.from(users)
		.where(eq(users.username, username));
	if (!user || (user.profileVisibility === 'private' && user.id !== viewerId)) return null;

	const visibleEntries = and(eq(libraryEntries.userId, user.id), visibleTo(viewerId));
	const [followers, following, isFollowing, completed, favorites] = await Promise.all([
		db.$count(follows, eq(follows.followeeId, user.id)),
		db.$count(follows, eq(follows.followerId, user.id)),
		db.$count(follows, and(eq(follows.followerId, viewerId), eq(follows.followeeId, user.id))),
		db
			.select({ type: media.type, count: sql<number>`count(*)::int` })
			.from(libraryEntries)
			.innerJoin(users, eq(users.id, libraryEntries.userId))
			.innerJoin(media, eq(media.id, libraryEntries.mediaId))
			.where(and(visibleEntries, eq(libraryEntries.status, 'completed')))
			.groupBy(media.type),
		db
			.select({
				mediaId: media.id,
				title: media.title,
				type: media.type,
				posterUrl: media.posterUrl,
				score: libraryEntries.score
			})
			.from(libraryEntries)
			.innerJoin(users, eq(users.id, libraryEntries.userId))
			.innerJoin(media, eq(media.id, libraryEntries.mediaId))
			.where(and(visibleEntries, eq(libraryEntries.isFavorite, true)))
			.orderBy(desc(libraryEntries.updatedAt))
			.limit(12)
	]);
	return {
		user,
		followers,
		following,
		isFollowing: isFollowing > 0,
		isSelf: user.id === viewerId,
		completed,
		favorites
	};
}

/** Followers or followed users of `userId`, hiding private profiles. */
export function followList(db: Db, userId: string, which: 'followers' | 'following') {
	const [mine, theirs] =
		which === 'followers'
			? [follows.followeeId, follows.followerId]
			: [follows.followerId, follows.followeeId];
	return db
		.select(publicUser)
		.from(follows)
		.innerJoin(users, eq(users.id, theirs))
		.where(and(eq(mine, userId), ne(users.profileVisibility, 'private')))
		.orderBy(desc(follows.createdAt))
		.limit(200);
}

/** Members whose username or display name starts with `q`, private profiles excluded. */
export function searchUsers(db: Db, q: string, limit = 5) {
	const prefix = `${q.replace(/[\\%_]/g, '\\$&')}%`;
	return db
		.select(publicUser)
		.from(users)
		.where(
			and(
				ne(users.profileVisibility, 'private'),
				or(ilike(users.username, prefix), ilike(users.displayName, prefix))
			)
		)
		.orderBy(users.username)
		.limit(limit);
}

export type FeedItem = Awaited<ReturnType<typeof feed>>['items'][number];

/**
 * Recent activity of the users `viewerId` follows (or of one user with `userId`), newest first.
 * Imports are left out (an import would flood the feed). Events written by one change
 * (e.g. completed + rated) share their timestamp and are merged into one item.
 */
export async function feed(
	db: Db,
	opts: { viewerId: string; userId?: string; before?: Date; limit?: number }
) {
	const limit = opts.limit ?? 30;
	const rows = await db
		.select({
			id: activityEvents.id,
			kind: activityEvents.kind,
			amount: activityEvents.amount,
			occurredAt: activityEvents.occurredAt,
			userId: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarUrl: users.avatarUrl,
			mediaId: media.id,
			title: media.title,
			type: media.type,
			posterUrl: media.posterUrl
		})
		.from(activityEvents)
		.innerJoin(users, eq(users.id, activityEvents.userId))
		.innerJoin(media, eq(media.id, activityEvents.mediaId))
		.innerJoin(
			libraryEntries,
			and(
				eq(libraryEntries.userId, activityEvents.userId),
				eq(libraryEntries.mediaId, activityEvents.mediaId)
			)
		)
		.where(
			and(
				opts.userId
					? eq(activityEvents.userId, opts.userId)
					: inArray(
							activityEvents.userId,
							db
								.select({ id: follows.followeeId })
								.from(follows)
								.where(eq(follows.followerId, opts.viewerId))
						),
				visibleTo(opts.viewerId),
				inArray(activityEvents.kind, [...FEED_KINDS]),
				ne(activityEvents.source, 'import'),
				opts.before ? lt(activityEvents.occurredAt, opts.before) : undefined
			)
		)
		.orderBy(desc(activityEvents.occurredAt), desc(activityEvents.id))
		.limit(limit);

	// A full page may cut a group of same-time events: leave that group for the next page
	let page = rows;
	if (rows.length === limit) {
		const last = rows.at(-1)!.occurredAt.getTime();
		const kept = rows.filter((r) => r.occurredAt.getTime() !== last);
		if (kept.length) page = kept;
	}

	const items: (Omit<(typeof rows)[number], 'kind' | 'amount'> & {
		kinds: (typeof FEED_KINDS)[number][];
		score: number | null;
	})[] = [];
	for (const { kind, amount, ...row } of page) {
		const prev = items.at(-1);
		const same =
			prev &&
			prev.userId === row.userId &&
			prev.mediaId === row.mediaId &&
			prev.occurredAt.getTime() === row.occurredAt.getTime();
		const item = same ? prev : { ...row, kinds: [], score: null };
		item.kinds.push(kind as (typeof FEED_KINDS)[number]);
		if (kind === 'rated') item.score = amount;
		if (!same) items.push(item);
	}
	return {
		items,
		next: rows.length === limit ? page.at(-1)!.occurredAt : null
	};
}

/** Feed items ready for the page: labels and dates formatted on the server. */
export const feedView = (items: FeedItem[], now = new Date()) =>
	items.map((i) => ({
		key: `${i.id}`,
		username: i.username,
		name: i.displayName || i.username,
		avatarUrl: i.avatarUrl,
		mediaId: i.mediaId,
		title: i.title,
		type: i.type,
		posterUrl: i.posterUrl,
		verb: activityVerb(i.kinds, i.type),
		score: i.score,
		when: timeAgo(i.occurredAt, now)
	}));

/** Members' ratings of a media: count, average (/100) and 10 buckets (0-9, …, 90-100). */
export async function ratingSummary(db: Db, mediaId: number, viewerId: string) {
	const rows = await db
		.select({
			bucket: sql<number>`least(${libraryEntries.score} / 10, 9)::int`,
			count: sql<number>`count(*)::int`,
			sum: sql<number>`sum(${libraryEntries.score})::int`
		})
		.from(libraryEntries)
		.innerJoin(users, eq(users.id, libraryEntries.userId))
		.where(
			and(
				eq(libraryEntries.mediaId, mediaId),
				sql`${libraryEntries.score} IS NOT NULL`,
				visibleTo(viewerId)
			)
		)
		.groupBy(sql`1`);
	const buckets = Array<number>(10).fill(0);
	for (const r of rows) buckets[r.bucket] = r.count;
	const count = rows.reduce((n, r) => n + r.count, 0);
	const average = count ? rows.reduce((n, r) => n + r.sum, 0) / count : null;
	return { count, average, buckets };
}

/**
 * Other members' entries on a media that `viewerId` can see: followed members first, then the
 * most recent. `reviewsOnly` keeps entries with a written review.
 */
export function mediaEntries(
	db: Db,
	mediaId: number,
	viewerId: string,
	opts: { reviewsOnly?: boolean; followedOnly?: boolean; limit?: number } = {}
) {
	const followed = sql<boolean>`exists (select 1 from ${follows} where ${follows.followerId} = ${viewerId} and ${follows.followeeId} = ${users.id})`;
	return db
		.select({
			...publicUser,
			status: libraryEntries.status,
			score: libraryEntries.score,
			review: libraryEntries.review,
			updatedAt: libraryEntries.updatedAt,
			followed
		})
		.from(libraryEntries)
		.innerJoin(users, eq(users.id, libraryEntries.userId))
		.where(
			and(
				eq(libraryEntries.mediaId, mediaId),
				ne(libraryEntries.userId, viewerId),
				visibleTo(viewerId),
				opts.reviewsOnly ? sql`btrim(coalesce(${libraryEntries.review}, '')) <> ''` : undefined,
				opts.followedOnly ? followed : undefined
			)
		)
		.orderBy(desc(followed), desc(libraryEntries.updatedAt))
		.limit(opts.limit ?? 20);
}
