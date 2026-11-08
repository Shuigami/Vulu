import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { storeEpisodes, upsertMedia, type Providers } from './catalogue';
import { createDb } from './db';
import { activityEvents, integrations, libraryEntries, media, users } from './db/schema';
import { parseJellyfinPayload, type JellyfinEvent } from './jellyfin';
import type { ProviderMedia } from './providers/types';
import { recordEvent, scrobble } from './scrobble';

/** The template rendered by the plugin: every value is a string. */
const payload = (over: Record<string, string> = {}) => ({
	event: 'PlaybackStop',
	user: 'ewan',
	itemId: 'a1b2c3d4e5f6',
	itemType: 'Episode',
	name: 'Le départ',
	seriesName: 'Frieren',
	season: '1',
	episode: '5',
	episodeEnd: '',
	year: '2023',
	tmdb: '',
	imdb: '',
	playedToCompletion: 'True',
	played: 'False',
	positionTicks: '0',
	runTimeTicks: '14400000000',
	...over
});

describe('parseJellyfinPayload', () => {
	it('reads an episode played to completion', () => {
		expect(parseJellyfinPayload(payload())).toMatchObject({
			kind: 'episode',
			seriesName: 'Frieren',
			season: 1,
			episode: 5,
			episodeEnd: null,
			year: 2023,
			watched: true
		});
	});

	it('decides what counts as watched', () => {
		const watched = (o: Record<string, string>) => parseJellyfinPayload(payload(o))!.watched;
		expect(watched({ playedToCompletion: 'False', positionTicks: '13000000000' })).toBe(true); // 90 %
		expect(watched({ playedToCompletion: 'False', positionTicks: '6000000000' })).toBe(false);
		expect(watched({ event: 'UserDataSaved', played: 'True' })).toBe(true);
		expect(watched({ event: 'UserDataSaved', played: 'False' })).toBe(false);
		expect(watched({ event: 'PlaybackStart' })).toBe(false);
	});

	it('ignores other items and rejects odd values', () => {
		expect(parseJellyfinPayload(payload({ itemType: 'Audio' }))).toBeNull();
		expect(parseJellyfinPayload(payload({ itemId: '../../etc' }))).toBeNull();
		expect(parseJellyfinPayload('nope')).toBeNull();
		const movie = parseJellyfinPayload(
			payload({ itemType: 'Movie', tmdb: '129', imdb: 'tt0245429; drop' })
		);
		expect(movie).toMatchObject({ kind: 'movie', tmdb: '129', imdb: null });
	});
});

// Integration: needs a migrated database (pnpm db:up && pnpm db:migrate).
describe('scrobble', () => {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set');
	const db = createDb(url);
	const run = randomUUID().slice(0, 8);
	const created = { media: [] as number[] };
	let userId = '';

	const work = (
		type: 'tv' | 'anime' | 'movie',
		id: string,
		titles: string[],
		over: Partial<ProviderMedia['media']> = {}
	): ProviderMedia => ({
		media: { type, title: titles[0], ...over },
		externalIds: [{ provider: type === 'anime' ? 'anilist' : 'tmdb', externalId: id }],
		titles: titles.map((title) => ({ title, locale: null }))
	});
	const add = async (w: ProviderMedia) => {
		const id = await upsertMedia(db, w);
		created.media.push(id);
		return id;
	};
	const noProviders = {
		tv: { name: 'tmdb', client: { search: async () => [] } },
		anime: { name: 'anilist', client: { search: async () => [] } }
	} as unknown as Providers;
	const event = (over: Record<string, string>) => parseJellyfinPayload(payload(over))!;
	const entryOf = async (mediaId: number) =>
		(await db.select().from(libraryEntries).where(eq(libraryEntries.mediaId, mediaId))).find(
			(e) => e.userId === userId
		);

	afterAll(async () => {
		await db.delete(users).where(eq(users.id, userId));
		await db.delete(media).where(inArray(media.id, created.media));
		await db.$client.end();
	});

	it('matches an anime from the library by another of its titles, once per day', async () => {
		[{ id: userId }] = await db
			.insert(users)
			.values({ email: `jf-${run}@test.vulu`, username: `jf_${run}` })
			.returning({ id: users.id });
		const frieren = await add(
			work('anime', `test-${run}-1`, [`Sousou no Frieren ${run}`, `Frieren ${run}`], {
				totalUnits: 28,
				runtimeMinutes: 24
			})
		);
		await db.insert(libraryEntries).values({ userId, mediaId: frieren });

		const ep5 = event({ seriesName: `Frieren ${run}`, itemId: `ep5${run}` });
		expect(await scrobble(db, noProviders, userId, ep5)).toBe('updated');
		expect(await entryOf(frieren)).toMatchObject({ progress: 5, status: 'in_progress' });
		// Play stop and "marked as played" for the same viewing
		expect(await scrobble(db, noProviders, userId, { ...ep5, event: 'UserDataSaved' })).toBe(
			'duplicate'
		);
		const ep3 = event({ seriesName: `Frieren ${run}`, episode: '3', itemId: `ep3${run}` });
		expect(await scrobble(db, noProviders, userId, ep3)).toBe('unchanged');

		const events = await db.select().from(activityEvents).where(eq(activityEvents.userId, userId));
		expect(events.find((e) => e.kind === 'episode')).toMatchObject({
			source: 'jellyfin',
			amount: 5,
			minutes: 120
		});
	});

	it('uses absolute episode numbers for later seasons, and completes movies by TMDB id', async () => {
		const show = await add(work('tv', `test-${run}-2`, [`Severance ${run}`], { totalUnits: 4 }));
		await storeEpisodes(db, show, {
			upcomingOnly: false,
			seasons: [1, 2].map((number) => ({
				number,
				title: null,
				airDate: null,
				episodeCount: 2,
				posterUrl: null
			})),
			episodes: [1, 2, 3, 4].map((n) => ({
				seasonNumber: n <= 2 ? 1 : 2,
				number: n <= 2 ? n : n - 2,
				absoluteNumber: n,
				title: null,
				airDate: null,
				runtimeMinutes: 50
			}))
		});
		const s2e2: JellyfinEvent = event({
			seriesName: `Severance ${run}`,
			season: '2',
			episode: '2',
			itemId: `s2e2${run}`
		});
		// Not in the library yet: matched in the catalogue (exact title), then added
		expect(await scrobble(db, noProviders, userId, s2e2)).toBe('updated');
		expect(await entryOf(show)).toMatchObject({ progress: 4, status: 'completed' });

		const movieId = `test-${run}-3`;
		const movie = await add(work('movie', movieId, [`Chihiro ${run}`]));
		const watched = event({ itemType: 'Movie', tmdb: '', itemId: `mv${run}` });
		// The template sends numeric TMDB ids; test ids are not numeric, so set it directly
		expect(await scrobble(db, noProviders, userId, { ...watched, tmdb: movieId })).toBe('updated');
		expect(await entryOf(movie)).toMatchObject({ status: 'completed' });
	});

	it('reports unknown shows, and keeps the last 20 events on the integration', async () => {
		const unknown = event({ seriesName: `Nothing like this ${run}`, itemId: `x${run}` });
		expect(await scrobble(db, noProviders, userId, unknown)).toBe('unmatched');

		const [{ id }] = await db
			.insert(integrations)
			.values({ userId, kind: 'jellyfin', webhookToken: `test-${run}-token-0123456789` })
			.returning({ id: integrations.id });
		for (let i = 0; i < 25; i++) {
			await recordEvent(db, id, {
				at: new Date().toISOString(),
				label: `E${i}`,
				result: 'updated'
			});
		}
		const [row] = await db.select().from(integrations).where(eq(integrations.id, id));
		const recent = (row.settings as { recent: { label: string }[] }).recent;
		expect(recent).toHaveLength(20);
		expect(recent[0].label).toBe('E24');
		expect(row.lastSyncedAt).toBeInstanceOf(Date);
	});
});
