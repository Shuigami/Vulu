import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { describeAirDate, episodeLabel, startOfToday, upcomingEpisodes } from './calendar';
import { staleAiringMedia, storeEpisodes, upsertMedia } from './catalogue';
import { createDb } from './db';
import { episodes, libraryEntries, media, users } from './db/schema';
import type { ProviderEpisodes, ProviderMedia } from './providers/types';

describe('calendar helpers', () => {
	it('computes midnight in Paris, winter and summer', () => {
		expect(startOfToday(new Date('2026-11-08T15:30:12.345Z')).toISOString()).toBe(
			'2026-11-07T23:00:00.000Z'
		);
		expect(startOfToday(new Date('2026-07-01T21:59:00Z')).toISOString()).toBe(
			'2026-06-30T22:00:00.000Z'
		);
		expect(startOfToday(new Date('2026-07-01T22:30:00Z')).toISOString()).toBe(
			'2026-07-01T22:00:00.000Z'
		);
	});

	it('shows a time only when the provider gave one', () => {
		expect(describeAirDate(new Date('2026-11-12T00:00:00Z'))).toEqual({
			dayKey: '2026-11-12',
			day: 'jeudi 12 novembre',
			weekday: 'jeu.',
			dayNumber: '12',
			time: null
		});
		expect(describeAirDate(new Date('2026-11-12T15:30:00Z')).time).toBe('16:30');
	});

	it('labels episodes by season', () => {
		expect(episodeLabel({ seasonNumber: 2, number: 3 })).toBe('S2E3');
		expect(episodeLabel({ seasonNumber: 0, number: 1 })).toBe('Spécial 1');
		expect(episodeLabel({ seasonNumber: null, number: 12 })).toBe('Ép. 12');
	});
});

// Integration: needs a migrated database (pnpm db:up && pnpm db:migrate).
describe('episodes in the database', () => {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set');
	const db = createDb(url);
	const run = randomUUID().slice(0, 8);
	const created = { users: [] as string[], media: [] as number[] };

	const show = (n: number, over: Partial<ProviderMedia['media']> = {}): ProviderMedia => ({
		media: { type: 'tv', title: `Show ${run} ${n}`, status: 'releasing', ...over },
		externalIds: [{ provider: 'tmdb', externalId: `test-${run}-${n}` }],
		titles: []
	});
	async function newMedia(n: number, over: Partial<ProviderMedia['media']> = {}) {
		const id = await upsertMedia(db, show(n, over));
		created.media.push(id);
		return id;
	}
	async function newUser() {
		const n = created.users.length;
		const [u] = await db
			.insert(users)
			.values({ email: `ep-${run}-${n}@test.vulu`, username: `ep_${run}_${n}` })
			.returning({ id: users.id });
		created.users.push(u.id);
		return u.id;
	}

	afterAll(async () => {
		await db.delete(users).where(inArray(users.id, created.users));
		await db.delete(media).where(inArray(media.id, created.media));
		await db.$client.end();
	});

	it('accepts media data that went through the JSON cache', async () => {
		const roundTripped = JSON.parse(JSON.stringify(show(1)));
		const id = await upsertMedia(db, roundTripped);
		created.media.push(id);
		const [row] = await db.select().from(media).where(eq(media.id, id));
		expect(row.lastSyncedAt).toBeInstanceOf(Date);
	});

	it('stores seasons and episodes idempotently and fills the runtime', async () => {
		const id = await newMedia(2);
		const data: ProviderEpisodes = {
			upcomingOnly: false,
			seasons: [{ number: 1, title: 'S1', airDate: null, episodeCount: 3, posterUrl: null }],
			episodes: [50, 60, 40].map((runtime, i) => ({
				seasonNumber: 1,
				number: i + 1,
				absoluteNumber: i + 1,
				title: `E${i + 1}`,
				airDate: new Date(`2026-0${i + 1}-01T00:00:00Z`),
				runtimeMinutes: runtime
			}))
		};
		expect(await storeEpisodes(db, id, data)).toBe(3);
		data.episodes[0].title = 'Renamed';
		await storeEpisodes(db, id, data);

		const rows = await db.select().from(episodes).where(eq(episodes.mediaId, id));
		expect(rows).toHaveLength(3);
		expect(rows.find((r) => r.number === 1)?.title).toBe('Renamed');
		const [m] = await db
			.select({ runtime: media.runtimeMinutes })
			.from(media)
			.where(eq(media.id, id));
		expect(m.runtime).toBe(50);
	});

	it('drops anime episodes that left the airing schedule', async () => {
		const id = await newMedia(3, { type: 'anime' });
		const day = 24 * 3600 * 1000;
		const ep = (number: number, inDays: number) => ({
			seasonNumber: null,
			number,
			absoluteNumber: number,
			title: null,
			airDate: new Date(Date.now() + inDays * day),
			runtimeMinutes: 24
		});
		await storeEpisodes(db, id, {
			upcomingOnly: true,
			seasons: [],
			episodes: [ep(5, 1), ep(6, 8)]
		});
		// Episode 6 is postponed out of the schedule, episode 5 moves by a day
		await storeEpisodes(db, id, { upcomingOnly: true, seasons: [], episodes: [ep(5, 2)] });
		const rows = await db.select().from(episodes).where(eq(episodes.mediaId, id));
		expect(rows.map((r) => r.number)).toEqual([5]);
	});

	it('lists upcoming episodes of followed media only, and picks stale airing media', async () => {
		const userId = await newUser();
		const followed = await newMedia(4);
		const dropped = await newMedia(5);
		const ignored = await newMedia(6);
		const soon = new Date(Date.now() + 3600 * 1000);
		for (const id of [followed, dropped, ignored]) {
			await storeEpisodes(db, id, {
				upcomingOnly: false,
				seasons: [{ number: 1, title: null, airDate: null, episodeCount: 1, posterUrl: null }],
				episodes: [
					{
						seasonNumber: 1,
						number: 1,
						absoluteNumber: 1,
						title: null,
						airDate: soon,
						runtimeMinutes: null
					}
				]
			});
		}
		await db.insert(libraryEntries).values([
			{ userId, mediaId: followed, status: 'in_progress' },
			{ userId, mediaId: dropped, status: 'dropped' }
		]);

		const from = new Date(Date.now() - 1000);
		const rows = await upcomingEpisodes(db, userId, from, new Date(Date.now() + 2 * 3600 * 1000));
		expect(rows.map((r) => r.mediaId)).toEqual([followed]);
		expect(rows[0]).toMatchObject({ seasonNumber: 1, number: 1 });

		// Just synced: not stale yet. Pretend the last sync was yesterday.
		expect((await staleAiringMedia(db)).map((m) => m.id)).not.toContain(followed);
		await db
			.update(media)
			.set({ lastSyncedAt: new Date(Date.now() - 24 * 3600 * 1000) })
			.where(inArray(media.id, [followed, ignored]));
		const stale = (await staleAiringMedia(db)).map((m) => m.id);
		expect(stale).toContain(followed);
		expect(stale).not.toContain(ignored); // nobody follows it
	});
});
