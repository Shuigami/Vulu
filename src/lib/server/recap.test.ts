import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from './db';
import { activityEvents, libraryEntries, media, users } from './db/schema';
import { ANONYMOUS_ID } from './guard';
import { personality, recapOpen, RECAP_RELEASE, releaseLabel, yearRecap } from './recap';

const none = { movie: 0, tv: 0, anime: 0, manga: 0, book: 0 };

describe('recap release', () => {
	it('opens at midnight in Paris and says the date in French', () => {
		expect(recapOpen(new Date(RECAP_RELEASE.getTime() - 1))).toBe(false);
		expect(recapOpen(RECAP_RELEASE)).toBe(true);
		expect(releaseLabel()).toBe('1er décembre');
	});
});

describe('personality', () => {
	it('is null for an empty year', () => {
		expect(personality({ completed: none, minutes: none, nightShare: 0, tracked: 0 })).toBeNull();
	});
	it('picks night owls, then all-rounders, then the main type', () => {
		const completed = { ...none, anime: 10, movie: 2 };
		expect(personality({ completed, minutes: none, nightShare: 0.5, tracked: 40 })?.title).toBe(
			'Oiseau de nuit'
		);
		// Too few live events to judge the hours
		expect(personality({ completed, minutes: none, nightShare: 0.5, tracked: 5 })?.title).toBe(
			'Otaku assumé'
		);
		expect(
			personality({
				completed: { ...none, anime: 3, movie: 3, book: 3 },
				minutes: none,
				nightShare: 0,
				tracked: 0
			})?.title
		).toBe('Touche-à-tout');
	});
});

// Integration: needs a migrated database (pnpm db:up && pnpm db:migrate).
describe('yearRecap in the database', () => {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set');
	const db = createDb(url);
	const run = randomUUID().slice(0, 8);
	let userId = '';
	let mediaIds: number[] = [];

	afterAll(async () => {
		await db.delete(users).where(inArray(users.id, [userId]));
		await db.delete(media).where(inArray(media.id, mediaIds));
		await db.$client.end();
	});

	it('sums the year in Paris time and hides private entries from others', async () => {
		[{ id: userId }] = await db
			.insert(users)
			.values({ email: `recap-${run}@test.vulu`, username: `recap_${run}` })
			.returning({ id: users.id });
		const rows = await db
			.insert(media)
			.values([
				{ type: 'movie', title: `Public ${run}`, runtimeMinutes: 120 },
				{ type: 'movie', title: `Secret ${run}`, runtimeMinutes: 90 }
			])
			.returning({ id: media.id });
		mediaIds = rows.map((r) => r.id);
		const [open, secret] = mediaIds;
		await db.insert(libraryEntries).values([
			{ userId, mediaId: open, status: 'completed', score: 80 },
			{ userId, mediaId: secret, status: 'completed', score: 95, isPrivate: true }
		]);
		await db.insert(activityEvents).values([
			{
				userId,
				mediaId: open,
				kind: 'completed',
				minutes: 120,
				occurredAt: new Date('2026-03-10T21:00:00Z')
			},
			{
				userId,
				mediaId: secret,
				kind: 'completed',
				minutes: 90,
				occurredAt: new Date('2026-07-01T12:00:00Z')
			},
			// 23:30 UTC on 31 Dec 2025 is already 2026 in Paris
			{ userId, mediaId: open, kind: 'rated', occurredAt: new Date('2025-12-31T23:30:00Z') },
			// The year before: not counted
			{
				userId,
				mediaId: open,
				kind: 'completed',
				minutes: 120,
				occurredAt: new Date('2025-06-01T12:00:00Z')
			}
		]);

		const own = await yearRecap(db, userId, userId);
		expect(own.completed.movie).toBe(2);
		expect(own.hours).toBe(4); // 210 min
		expect(own.top.map((t) => t.mediaId)).toEqual([secret, open]);
		expect(own.busiestMonth).toBe(3);
		expect(own.activeDays).toBe(3);
		expect(own.perMonth[2]).toBe(2); // March: 120 min
		expect(own.perMonth).toHaveLength(12);
		expect(own.wall).toEqual([]); // no posters on the test media

		const seen = await yearRecap(db, userId, ANONYMOUS_ID);
		expect(seen.completed.movie).toBe(1);
		expect(seen.top.map((t) => t.mediaId)).toEqual([open]);
		expect(seen.minutes.movie).toBe(120);
	});
});
