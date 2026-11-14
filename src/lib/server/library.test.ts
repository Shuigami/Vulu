import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { fromScale, toScale } from '../labels';
import { createDb } from './db';
import { activityEvents, libraryEntries, media, users } from './db/schema';
import {
	addToLibrary,
	applyChange,
	countByStatus,
	incrementProgress,
	listEntries,
	updateEntry
} from './library';

const TODAY = '2026-11-08';
const entry = (over: Partial<typeof libraryEntries.$inferSelect> = {}) => ({
	id: 1,
	userId: 'u',
	mediaId: 1,
	status: 'planned' as const,
	score: null,
	progress: 0,
	progressSecondary: 0,
	repeatCount: 0,
	startedOn: null,
	completedOn: null,
	review: null,
	notes: null,
	isFavorite: false,
	isPrivate: false,
	createdAt: new Date(),
	updatedAt: new Date(),
	...over
});
const anime = { type: 'anime' as const, totalUnits: 12, runtimeMinutes: 24 };

describe('applyChange', () => {
	it('starts a planned entry on first progress and logs watched minutes', () => {
		const { next, events } = applyChange(entry(), { progress: 2 }, anime, TODAY);
		expect(next).toMatchObject({ status: 'in_progress', progress: 2, startedOn: TODAY });
		expect(events).toEqual([
			{ kind: 'episode', amount: 2, minutes: 48 },
			{ kind: 'started', amount: null, minutes: null }
		]);
	});

	it('completes the entry when the last unit is reached', () => {
		const current = entry({ status: 'in_progress', progress: 11, startedOn: '2026-01-01' });
		const { next, events } = applyChange(current, { progress: 12 }, anime, TODAY);
		expect(next).toMatchObject({
			status: 'completed',
			completedOn: TODAY,
			startedOn: '2026-01-01'
		});
		expect(events.map((e) => e.kind)).toEqual(['episode', 'completed']);
	});

	it('fills progress when marked completed, and caps progress at the total', () => {
		expect(applyChange(entry(), { status: 'completed' }, anime, TODAY).next.progress).toBe(12);
		expect(applyChange(entry(), { progress: 99 }, anime, TODAY).next.progress).toBe(12);
	});

	it('keeps an explicit status chosen with the progress', () => {
		const { next } = applyChange(entry(), { progress: 3, status: 'paused' }, anime, TODAY);
		expect(next.status).toBe('paused');
	});

	it('logs a movie runtime on completion, and ratings', () => {
		const movie = { type: 'movie' as const, totalUnits: null, runtimeMinutes: 125 };
		const { events } = applyChange(entry(), { status: 'completed', score: 90 }, movie, TODAY);
		expect(events).toEqual([
			{ kind: 'completed', amount: null, minutes: 125 },
			{ kind: 'rated', amount: 90, minutes: null }
		]);
	});
});

describe('score scale', () => {
	it('converts between storage (/100) and display scales', () => {
		expect(toScale(95, 10)).toBe(9.5);
		expect(toScale(95, 5)).toBe(4.8);
		expect(toScale(95, 100)).toBe(95);
		expect(fromScale(9.5, 10)).toBe(95);
		expect(fromScale(4, 5)).toBe(80);
		expect(fromScale(12, 10)).toBe(100);
	});
});

// Integration: needs a migrated database (pnpm db:up && pnpm db:migrate).
describe('library entries in the database', () => {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set');
	const db = createDb(url);
	const run = randomUUID().slice(0, 8);
	const created = { users: [] as string[], media: [] as number[] };

	async function fixture() {
		const [user] = await db
			.insert(users)
			.values({
				email: `lib-${run}-${created.users.length}@test.vulu`,
				username: `lib_${run}_${created.users.length}`
			})
			.returning({ id: users.id });
		const [m] = await db
			.insert(media)
			.values({ type: 'tv', title: `Show ${run}`, totalUnits: 3, runtimeMinutes: 50 })
			.returning({ id: media.id });
		created.users.push(user.id);
		created.media.push(m.id);
		return { userId: user.id, mediaId: m.id };
	}

	afterAll(async () => {
		await db.delete(users).where(inArray(users.id, created.users));
		await db.delete(media).where(inArray(media.id, created.media));
		await db.$client.end();
	});

	it('adds once, increments to completion and writes the journal', async () => {
		const { userId, mediaId } = await fixture();
		const id = await addToLibrary(db, userId, mediaId);
		expect(await addToLibrary(db, userId, mediaId)).toBe(id);

		for (let i = 0; i < 3; i++) expect(await incrementProgress(db, userId, id)).toBe(true);
		const [row] = await listEntries(db, userId, { status: 'completed' });
		expect(row).toMatchObject({ id, progress: 3, status: 'completed', type: 'tv' });

		const events = await db
			.select({ kind: activityEvents.kind, minutes: activityEvents.minutes })
			.from(activityEvents)
			.where(eq(activityEvents.userId, userId));
		expect(events.filter((e) => e.kind === 'episode')).toHaveLength(3);
		expect(events.reduce((sum, e) => sum + (e.minutes ?? 0), 0)).toBe(150);
		expect(events.map((e) => e.kind)).toContain('completed');
	});

	it('searches titles without accents, sorts and pages', async () => {
		const { userId, mediaId } = await fixture();
		const [other] = await db
			.insert(media)
			.values({ type: 'movie', title: `Sōsō ${run}` })
			.returning({ id: media.id });
		created.media.push(other.id);
		await addToLibrary(db, userId, mediaId);
		await addToLibrary(db, userId, other.id);

		const found = await listEntries(db, userId, { q: `soso ${run}` });
		expect(found.map((e) => e.mediaId)).toEqual([other.id]);
		expect(await listEntries(db, userId, { q: '100%' })).toEqual([]);

		const byTitle = await listEntries(db, userId, { sort: 'title' });
		expect(byTitle.map((e) => e.mediaId)).toEqual([mediaId, other.id]);
		const page2 = await listEntries(db, userId, { sort: 'title', limit: 1, offset: 1 });
		expect(page2).toMatchObject([{ mediaId: other.id, total: 2 }]);

		// Last seen: a viewing counts (even an old one), a rating does not
		await db.insert(activityEvents).values([
			{ userId, mediaId: other.id, kind: 'completed', occurredAt: new Date('2020-01-01') },
			{ userId, mediaId, kind: 'rated', amount: 80 }
		]);
		const bySeen = await listEntries(db, userId, { sort: 'seen' });
		expect(bySeen.map((e) => e.mediaId)).toEqual([other.id, mediaId]);
	});

	it('filters favorites and counts entries per status', async () => {
		const { userId, mediaId } = await fixture();
		const [other] = await db
			.insert(media)
			.values({ type: 'movie', title: `Fav ${run}` })
			.returning({ id: media.id });
		created.media.push(other.id);
		await addToLibrary(db, userId, mediaId);
		const fav = await addToLibrary(db, userId, other.id);
		await updateEntry(db, userId, fav, { status: 'completed', isFavorite: true });

		const favorites = await listEntries(db, userId, { favorite: true });
		expect(favorites.map((e) => e.id)).toEqual([fav]);
		expect(await countByStatus(db, userId)).toEqual({ planned: 1, completed: 1 });
		expect(await countByStatus(db, userId, { favorite: true })).toEqual({ completed: 1 });
		expect(await countByStatus(db, userId, { type: 'tv' })).toEqual({ planned: 1 });
	});

	it("refuses to update another user's entry", async () => {
		const owner = await fixture();
		const other = await fixture();
		const id = await addToLibrary(db, owner.userId, owner.mediaId);
		expect(await updateEntry(db, other.userId, id, { progress: 1 })).toBe(false);
		expect(await listEntries(db, owner.userId)).toMatchObject([{ progress: 0 }]);
	});
});
