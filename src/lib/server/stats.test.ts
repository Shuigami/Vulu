import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from './db';
import { activityEvents, libraryEntries, media, mediaExternalIds, users } from './db/schema';
import { entriesCsv, exportData } from './export';
import { parseCsv } from './imports/goodreads';
import { lastMonths, userStats } from './stats';

describe('lastMonths', () => {
	it('lists the last 12 months in Paris time, oldest first', () => {
		// 23:30 UTC on 31 Dec is already January in Paris
		const months = lastMonths(new Date('2026-12-31T23:30:00Z'));
		expect(months).toHaveLength(12);
		expect(months[0]).toBe('2026-02');
		expect(months.at(-1)).toBe('2027-01');
	});
});

// Integration: needs a migrated database (pnpm db:up && pnpm db:migrate).
describe('stats and export in the database', () => {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set');
	const db = createDb(url);
	const run = randomUUID().slice(0, 8);
	const now = new Date('2026-11-10T12:00:00Z');
	let userId = '';
	let mediaIds: number[] = [];

	afterAll(async () => {
		await db.delete(users).where(inArray(users.id, [userId]));
		await db.delete(media).where(inArray(media.id, mediaIds));
		await db.$client.end();
	});

	it('sums the journal and exports the library', async () => {
		[{ id: userId }] = await db
			.insert(users)
			.values({ email: `stats-${run}@test.vulu`, username: `stats_${run}` })
			.returning({ id: users.id });
		const rows = await db
			.insert(media)
			.values([
				{ type: 'movie', title: `Film, "${run}"`, runtimeMinutes: 120 },
				{ type: 'manga', title: `Manga ${run}` }
			])
			.returning({ id: media.id });
		mediaIds = rows.map((r) => r.id);
		const [film, manga] = mediaIds;
		await db.insert(mediaExternalIds).values({
			mediaId: film,
			provider: 'tmdb',
			externalId: `t${run}`,
			isPrimary: true
		});
		await db.insert(libraryEntries).values([
			{ userId, mediaId: film, status: 'completed', score: 85, review: 'Bien,\nvraiment' },
			{ userId, mediaId: manga, status: 'in_progress', progress: 30 }
		]);
		await db.insert(activityEvents).values([
			{ userId, mediaId: film, kind: 'completed', minutes: 120, occurredAt: now },
			// A year ago: counted in totals, outside the monthly window
			{ userId, mediaId: film, kind: 'completed', occurredAt: new Date('2025-10-01T12:00:00Z') },
			{ userId, mediaId: manga, kind: 'chapter', amount: 30, occurredAt: now }
		]);

		const stats = await userStats(db, userId, now);
		expect(stats.minutes.movie).toBe(120);
		expect(stats.completed.movie).toBe(2);
		expect(stats.units.chapter).toBe(30);
		expect(stats.perMonth.at(-1)).toMatchObject({ month: '2026-11', counts: { movie: 1 } });
		expect(stats.perMonth.reduce((n, p) => n + p.counts.movie, 0)).toBe(1);

		const data = await exportData(db, userId, undefined, now);
		expect(data.entries).toHaveLength(2);
		expect(data.history).toHaveLength(3);
		const mangaOnly = await exportData(db, userId, 'manga', now);
		expect(mangaOnly.entries.map((e) => e.type)).toEqual(['manga']);
		expect(mangaOnly.history).toHaveLength(1);
		const [header, ...lines] = parseCsv(entriesCsv(data.entries).slice(1)).filter(
			(r) => r.length > 1
		);
		const row = Object.fromEntries(header.map((h, i) => [h, lines[0][i]]));
		expect(row).toMatchObject({
			title: `Film, "${run}"`,
			score_100: '85',
			review: 'Bien,\nvraiment',
			tmdb: `t${run}`
		});
	});
});
