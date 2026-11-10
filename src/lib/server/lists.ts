// Custom lists (lists, list_items). A list is seen by its owner, or by anyone when it is
// public and its owner's profile is not private. Every change checks ownership.
import { and, asc, desc, eq, max, ne, or, sql } from 'drizzle-orm';
import type { Db } from './db';
import { libraryEntries, listItems, lists, media, users } from './db/schema';

export const LIST_NAME_MAX = 80;
export const LIST_DESCRIPTION_MAX = 500;

export type ListInput = { name: string; description: string; isPublic: boolean };

const visibleList = (viewerId: string) =>
	or(
		eq(lists.userId, viewerId),
		and(eq(lists.visibility, 'public'), ne(users.profileVisibility, 'private'))
	);

/** Trimmed fields, or a French error message. */
export function parseListInput(form: FormData): ListInput | string {
	const name = String(form.get('name') ?? '').trim();
	const description = String(form.get('description') ?? '').trim();
	if (!name) return 'Donne un nom à la liste.';
	if (name.length > LIST_NAME_MAX) return `Le nom fait au plus ${LIST_NAME_MAX} caractères.`;
	if (description.length > LIST_DESCRIPTION_MAX)
		return `La description fait au plus ${LIST_DESCRIPTION_MAX} caractères.`;
	return { name, description, isPublic: form.get('public') === 'on' };
}

export async function createList(db: Db, userId: string, input: ListInput) {
	const [row] = await db
		.insert(lists)
		.values({
			userId,
			name: input.name,
			description: input.description || null,
			visibility: input.isPublic ? 'public' : 'private'
		})
		.returning({ id: lists.id });
	return row.id;
}

/** false when the list does not exist or belongs to someone else. */
export async function updateList(db: Db, userId: string, listId: number, input: ListInput) {
	const rows = await db
		.update(lists)
		.set({
			name: input.name,
			description: input.description || null,
			visibility: input.isPublic ? 'public' : 'private'
		})
		.where(and(eq(lists.id, listId), eq(lists.userId, userId)))
		.returning({ id: lists.id });
	return rows.length > 0;
}

export async function deleteList(db: Db, userId: string, listId: number) {
	const rows = await db
		.delete(lists)
		.where(and(eq(lists.id, listId), eq(lists.userId, userId)))
		.returning({ id: lists.id });
	return rows.length > 0;
}

const owns = async (db: Db, userId: string, listId: number) =>
	(await db.$count(lists, and(eq(lists.id, listId), eq(lists.userId, userId)))) > 0;

/** Appends the work at the end of the list; adding it twice changes nothing. */
export async function addToList(db: Db, userId: string, listId: number, mediaId: number) {
	if (!(await owns(db, userId, listId))) return false;
	await db.transaction(async (tx) => {
		const [last] = await tx
			.select({ position: max(listItems.position) })
			.from(listItems)
			.where(eq(listItems.listId, listId));
		await tx
			.insert(listItems)
			.values({ listId, mediaId, position: (last?.position ?? 0) + 1 })
			.onConflictDoNothing();
		await tx.update(lists).set({ updatedAt: new Date() }).where(eq(lists.id, listId));
	});
	return true;
}

export async function removeFromList(db: Db, userId: string, listId: number, mediaId: number) {
	if (!(await owns(db, userId, listId))) return false;
	await db
		.delete(listItems)
		.where(and(eq(listItems.listId, listId), eq(listItems.mediaId, mediaId)));
	return true;
}

/** Lists of `ownerId` that `viewerId` may see, most recently changed first, with a few covers. */
export async function listsOf(db: Db, ownerId: string, viewerId: string) {
	return db
		.select({
			id: lists.id,
			name: lists.name,
			description: lists.description,
			visibility: lists.visibility,
			count: sql<number>`(select count(*)::int from ${listItems} where ${listItems.listId} = ${lists.id})`,
			posters: sql<string[]>`array(select m.poster_url from ${listItems} li
				join ${media} m on m.id = li.media_id
				where li.list_id = ${lists.id} and m.poster_url is not null
				order by li.position limit 4)`
		})
		.from(lists)
		.innerJoin(users, eq(users.id, lists.userId))
		.where(and(eq(lists.userId, ownerId), visibleList(viewerId)))
		.orderBy(desc(lists.updatedAt), desc(lists.id));
}

export const LIST_SORTS = ['position', 'recent', 'title', 'year', 'score'] as const;
export type ListSort = (typeof LIST_SORTS)[number];

const itemOrder = {
	position: [sql`${listItems.position}`],
	recent: [sql`${listItems.position} desc`],
	title: [sql`lower(${media.title})`],
	year: [sql`${media.startDate} desc nulls last`],
	score: [sql`${libraryEntries.score} desc nulls last`]
} satisfies Record<ListSort, unknown[]>;

/**
 * One list with its owner and works, or null when missing or hidden from the viewer.
 * `score` is the viewer's own score, so a list never reveals its owner's private entries.
 */
export async function getList(
	db: Db,
	listId: number,
	viewerId: string,
	sort: ListSort = 'position'
) {
	const [list] = await db
		.select({
			id: lists.id,
			name: lists.name,
			description: lists.description,
			visibility: lists.visibility,
			ownerId: users.id,
			username: users.username,
			displayName: users.displayName
		})
		.from(lists)
		.innerJoin(users, eq(users.id, lists.userId))
		.where(and(eq(lists.id, listId), visibleList(viewerId)));
	if (!list) return null;
	const items = await db
		.select({
			mediaId: media.id,
			type: media.type,
			title: media.title,
			posterUrl: media.posterUrl,
			year: sql<number | null>`extract(year from ${media.startDate})::int`,
			score: libraryEntries.score
		})
		.from(listItems)
		.innerJoin(media, eq(media.id, listItems.mediaId))
		.leftJoin(
			libraryEntries,
			and(eq(libraryEntries.mediaId, media.id), eq(libraryEntries.userId, viewerId))
		)
		.where(eq(listItems.listId, listId))
		.orderBy(...itemOrder[sort], asc(listItems.position));
	return { ...list, isOwner: list.ownerId === viewerId, items };
}

/** The user's lists with whether each one holds the work, for the work page. */
export function listsForMedia(db: Db, userId: string, mediaId: number) {
	return db
		.select({
			id: lists.id,
			name: lists.name,
			has: sql<boolean>`exists (select 1 from ${listItems} where ${listItems.listId} = ${lists.id} and ${listItems.mediaId} = ${mediaId})`
		})
		.from(lists)
		.where(eq(lists.userId, userId))
		.orderBy(asc(lists.name));
}
