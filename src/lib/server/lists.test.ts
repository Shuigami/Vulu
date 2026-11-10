import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from './db';
import { media, users } from './db/schema';
import {
	addToList,
	createList,
	deleteList,
	getList,
	listsForMedia,
	listsOf,
	parseListInput,
	removeFromList,
	updateList
} from './lists';

const form = (fields: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return f;
};

describe('parseListInput', () => {
	it('trims fields and validates the name', () => {
		expect(parseListInput(form({ name: '  Top  ', public: 'on' }))).toEqual({
			name: 'Top',
			description: '',
			isPublic: true
		});
		expect(parseListInput(form({ name: '   ' }))).toBeTypeOf('string');
		expect(parseListInput(form({ name: 'x'.repeat(81) }))).toBeTypeOf('string');
	});
});

// Integration: needs a migrated database (pnpm db:up && pnpm db:migrate).
describe('lists in the database', () => {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set');
	const db = createDb(url);
	const run = randomUUID().slice(0, 8);
	const created = { users: [] as string[], media: [] as number[] };

	const user = async (n: string, profileVisibility: 'public' | 'private' = 'public') => {
		const [u] = await db
			.insert(users)
			.values({
				email: `lists-${run}-${n}@test.vulu`,
				username: `l_${run}_${n}`,
				profileVisibility
			})
			.returning({ id: users.id });
		created.users.push(u.id);
		return u.id;
	};

	afterAll(async () => {
		await db.delete(users).where(inArray(users.id, created.users));
		await db.delete(media).where(inArray(media.id, created.media));
		await db.$client.end();
	});

	it('keeps order, ignores duplicates and only lets the owner change a list', async () => {
		const owner = await user('owner');
		const other = await user('other');
		const rows = await db
			.insert(media)
			.values([
				{ type: 'movie', title: `A ${run}` },
				{ type: 'book', title: `B ${run}` }
			])
			.returning({ id: media.id });
		created.media.push(...rows.map((r) => r.id));
		const [a, b] = created.media;

		const id = await createList(db, owner, { name: 'Top', description: '', isPublic: false });
		expect(await addToList(db, owner, id, b)).toBe(true);
		expect(await addToList(db, owner, id, a)).toBe(true);
		expect(await addToList(db, owner, id, b)).toBe(true);
		expect(await addToList(db, other, id, a)).toBe(false);

		const list = await getList(db, id, owner);
		expect(list?.items.map((i) => i.mediaId)).toEqual([b, a]);
		expect(list?.isOwner).toBe(true);
		expect(await listsForMedia(db, owner, a)).toMatchObject([{ id, has: true }]);

		// Private: hidden from others until made public
		expect(await getList(db, id, other)).toBeNull();
		expect(await listsOf(db, owner, other)).toEqual([]);
		expect(await updateList(db, other, id, { name: 'Hack', description: '', isPublic: true })).toBe(
			false
		);
		await updateList(db, owner, id, {
			name: 'Top 2',
			description: 'Les meilleurs',
			isPublic: true
		});
		expect(await getList(db, id, other)).toMatchObject({ name: 'Top 2', isOwner: false });
		expect(await listsOf(db, owner, other)).toMatchObject([{ id, count: 2 }]);

		expect(await removeFromList(db, other, id, a)).toBe(false);
		await removeFromList(db, owner, id, a);
		expect((await getList(db, id, owner))?.items).toHaveLength(1);

		expect(await deleteList(db, other, id)).toBe(false);
		expect(await deleteList(db, owner, id)).toBe(true);
		expect(await getList(db, id, owner)).toBeNull();
	});

	it('hides public lists of a private profile', async () => {
		const owner = await user('private', 'private');
		const viewer = await user('viewer');
		const id = await createList(db, owner, { name: 'Pub', description: '', isPublic: true });
		expect(await getList(db, id, viewer)).toBeNull();
		expect(await getList(db, id, owner)).not.toBeNull();
	});
});
