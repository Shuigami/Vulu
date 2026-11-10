import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { timeAgo } from './calendar';
import { createDb } from './db';
import { activityEvents, media, users } from './db/schema';
import { addToLibrary, updateEntry } from './library';
import {
	feed,
	follow,
	followList,
	mediaEntries,
	profileByUsername,
	ratingSummary,
	searchUsers,
	unfollow
} from './social';

describe('timeAgo', () => {
	const now = new Date('2026-11-09T15:00:00Z');
	it('is relative for recent dates, then a short date', () => {
		expect(timeAgo(new Date('2026-11-09T14:59:30Z'), now)).toBe('à l’instant');
		expect(timeAgo(new Date('2026-11-09T12:00:00Z'), now)).toBe('il y a 3 h');
		expect(timeAgo(new Date('2026-11-08T08:00:00Z'), now)).toBe('hier');
		expect(timeAgo(new Date('2026-11-05T08:00:00Z'), now)).toBe('il y a 4 j');
		expect(timeAgo(new Date('2026-10-01T08:00:00Z'), now)).toBe('1 oct.');
	});
});

// Integration: needs a migrated database (pnpm db:up && pnpm db:migrate).
describe('follows and feed', () => {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set');
	const db = createDb(url);
	const run = randomUUID().slice(0, 8);
	const created = { users: [] as string[], media: [] as number[] };

	async function user(name: string, profileVisibility: 'public' | 'private' = 'public') {
		const username = `soc_${run}_${name}`;
		const [u] = await db
			.insert(users)
			.values({ email: `${username}@test.vulu`, username, profileVisibility })
			.returning({ id: users.id });
		created.users.push(u.id);
		return { id: u.id, username };
	}
	async function movie(title: string) {
		const [m] = await db
			.insert(media)
			.values({ type: 'movie', title: `${title} ${run}`, runtimeMinutes: 100 })
			.returning({ id: media.id });
		created.media.push(m.id);
		return m.id;
	}
	async function watch(userId: string, mediaId: number, extra = {}) {
		const entryId = await addToLibrary(db, userId, mediaId);
		await updateEntry(db, userId, entryId, { status: 'completed', score: 80, ...extra });
		return entryId;
	}

	afterAll(async () => {
		await db.delete(users).where(inArray(users.id, created.users));
		await db.delete(media).where(inArray(media.id, created.media));
		await db.$client.end();
	});

	it('follows once, refuses oneself and private profiles, and unfollows', async () => {
		const [me, bob, hidden] = [await user('me'), await user('bob'), await user('hid', 'private')];
		expect(await follow(db, me.id, bob.username)).toBe(true);
		expect(await follow(db, me.id, bob.username)).toBe(true);
		expect(await follow(db, me.id, me.username)).toBe(false);
		expect(await follow(db, me.id, hidden.username)).toBe(false);

		const profile = await profileByUsername(db, bob.username, me.id);
		expect(profile).toMatchObject({ followers: 1, following: 0, isFollowing: true });
		expect((await followList(db, me.id, 'following')).map((u) => u.username)).toEqual([
			bob.username
		]);
		expect(await profileByUsername(db, hidden.username, me.id)).toBeNull();
		expect(await profileByUsername(db, hidden.username, hidden.id)).not.toBeNull();

		await unfollow(db, me.id, bob.username);
		expect((await profileByUsername(db, bob.username, me.id))?.isFollowing).toBe(false);
	});

	it('shows followed activity, merged per change, without private entries or imports', async () => {
		const [me, ann, eve] = [await user('me2'), await user('ann'), await user('eve')];
		await follow(db, me.id, ann.username);
		await follow(db, me.id, eve.username);
		const [a, b, c] = [await movie('A'), await movie('B'), await movie('C')];

		await watch(ann.id, a);
		await watch(ann.id, b, { isPrivate: true });
		const imported = await addToLibrary(db, eve.id, c);
		await updateEntry(db, eve.id, imported, { status: 'completed' }, { source: 'import' });

		const { items, next } = await feed(db, { viewerId: me.id });
		expect(next).toBeNull();
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ username: ann.username, mediaId: a, score: 80 });
		expect(items[0].kinds.toSorted()).toEqual(['completed', 'rated']);

		// Ann still sees her private entry on her own profile
		expect(await feed(db, { viewerId: ann.id, userId: ann.id })).toMatchObject({
			items: [{ mediaId: b }, { mediaId: a }]
		});

		await db.update(users).set({ profileVisibility: 'private' }).where(eq(users.id, ann.id));
		expect((await feed(db, { viewerId: me.id })).items).toEqual([]);
	});

	it('pages without splitting a change', async () => {
		const [me, joe] = [await user('me3'), await user('joe')];
		await follow(db, me.id, joe.username);
		for (const t of ['P1', 'P2', 'P3']) await watch(joe.id, await movie(t));

		// limit 3 cuts the second change (2 events each): it moves to the next page whole
		const first = await feed(db, { viewerId: me.id, limit: 3 });
		expect(first.items).toHaveLength(1);
		const second = await feed(db, { viewerId: me.id, limit: 3, before: first.next! });
		expect(second.items.map((i) => i.kinds.toSorted())).toEqual([['completed', 'rated']]);
		const third = await feed(db, { viewerId: me.id, limit: 3, before: second.next! });
		expect(third.items).toHaveLength(1);
		expect(third.next).toBeNull();

		const events = await db.$count(activityEvents, eq(activityEvents.userId, joe.id));
		expect(events).toBe(6);
	});

	it('finds public members by prefix', async () => {
		const zed = await user('zed');
		await user('zoe', 'private');
		expect((await searchUsers(db, `soc_${run}_z`)).map((u) => u.username)).toEqual([zed.username]);
		expect(await searchUsers(db, '%')).not.toContainEqual(expect.objectContaining({ id: zed.id }));
	});

	it('summarises visible ratings and lists reviews, followed members first', async () => {
		const [me, a, b, c] = [await user('me4'), await user('ra'), await user('rb'), await user('rc')];
		const film = await movie('R');
		await watch(me.id, film, { score: 40 });
		await watch(a.id, film, { score: 100, review: 'Chef-d’œuvre.' });
		await watch(b.id, film, { score: 0, review: '  ' });
		await watch(c.id, film, { score: 85, review: 'Très bien.', isPrivate: true });
		await follow(db, me.id, b.username);

		const summary = await ratingSummary(db, film, me.id);
		expect(summary.count).toBe(3);
		expect(summary.average).toBeCloseTo(140 / 3);
		expect(summary.buckets).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

		const others = await mediaEntries(db, film, me.id);
		expect(others.map((e) => [e.username, e.followed])).toEqual([
			[b.username, true],
			[a.username, false]
		]);
		const reviews = await mediaEntries(db, film, me.id, { reviewsOnly: true });
		expect(reviews.map((e) => e.review)).toEqual(['Chef-d’œuvre.']);
		expect(await mediaEntries(db, film, me.id, { followedOnly: true })).toHaveLength(1);
	});
});
