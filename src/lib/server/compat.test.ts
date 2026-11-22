import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { compatibility, compatPercent } from './compat';
import { createDb } from './db';
import { libraryEntries, media, users } from './db/schema';
import { ANONYMOUS_ID } from './guard';

describe('compatPercent', () => {
	it('needs three shared scores and costs two points per point of average gap', () => {
		expect(compatPercent([0, 0])).toBeNull();
		expect(compatPercent([0, 0, 0])).toBe(100);
		expect(compatPercent([10, -10, 10])).toBe(80);
		expect(compatPercent([90, -90, 90])).toBe(0);
	});
});

// Integration: needs a migrated database (pnpm db:up && pnpm db:migrate).
describe('compatibility in the database', () => {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set');
	const db = createDb(url);
	const run = randomUUID().slice(0, 8);
	let ids: string[] = [];
	let mediaIds: number[] = [];

	afterAll(async () => {
		await db.delete(users).where(inArray(users.id, ids));
		await db.delete(media).where(inArray(media.id, mediaIds));
		await db.$client.end();
	});

	it('compares shared scores and leaves out private entries for others', async () => {
		const rows = await db
			.insert(users)
			.values([
				{ email: `ca-${run}@test.vulu`, username: `ca_${run}` },
				{ email: `cb-${run}@test.vulu`, username: `cb_${run}` }
			])
			.returning({ id: users.id });
		ids = rows.map((r) => r.id);
		const [a, b] = ids;
		mediaIds = (
			await db
				.insert(media)
				.values([1, 2, 3, 4].map((n) => ({ type: 'movie' as const, title: `C${n} ${run}` })))
				.returning({ id: media.id })
		).map((r) => r.id);
		const [m1, m2, m3, m4] = mediaIds;
		await db.insert(libraryEntries).values([
			{ userId: a, mediaId: m1, score: 90 },
			{ userId: b, mediaId: m1, score: 80 },
			{ userId: a, mediaId: m2, score: 80 },
			{ userId: b, mediaId: m2, score: 80 },
			{ userId: a, mediaId: m3, score: 20 },
			{ userId: b, mediaId: m3, score: 90 },
			{ userId: a, mediaId: m4, score: 50, isPrivate: true },
			{ userId: b, mediaId: m4, score: 50 }
		]);

		const own = await compatibility(db, a, b, a);
		expect(own.shared).toBe(4);
		// Gaps 10, 0, 70, 0: average 20
		expect(own.percent).toBe(60);
		expect(own.loved.map((l) => l.mediaId)).toEqual([m1, m2]);
		expect(own.clashes).toMatchObject([{ mediaId: m3, a: 20, b: 90 }]);

		const seen = await compatibility(db, a, b, ANONYMOUS_ID);
		expect(seen.shared).toBe(3);
	});
});
