import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { describeAirDate, episodeLabel, startOfToday, upcomingEpisodes } from './calendar';
import {
	matchAnimeEpisodes,
	staleAiringMedia,
	storeEpisodes,
	syncEpisodes,
	upsertMedia,
	type Providers
} from './catalogue';
import { createDb } from './db';
import { activityEvents, episodes, episodeViews, libraryEntries, media, users } from './db/schema';
import { episodePage, markEpisode, markSeason, rateEpisode, seasonList } from './episodes';
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

/** A TMDB show: season 1 (3 episodes from 2025-01-05), season 2 (6 from 2026-01-04), weekly. */
const tmdbShow = (): ProviderEpisodes['episodes'] => {
	const week = (from: string, i: number) => new Date(Date.parse(from) + i * 7 * 86_400_000);
	return [
		{
			seasonNumber: 0,
			number: 1,
			absoluteNumber: null,
			title: 'OAV',
			airDate: null,
			runtimeMinutes: 24
		},
		...[1, 2, 3].map((n) => ({
			seasonNumber: 1,
			number: n,
			absoluteNumber: n,
			title: `S1E${n}`,
			airDate: week('2025-01-05T00:00:00Z', n - 1),
			runtimeMinutes: 24,
			overview: `Synopsis S1E${n}`,
			stillUrl: null
		})),
		...[1, 2, 3, 4, 5, 6].map((n) => ({
			seasonNumber: 2,
			number: n,
			absoluteNumber: 3 + n,
			title: `S2E${n}`,
			airDate: week('2026-01-04T00:00:00Z', n - 1),
			runtimeMinutes: 24,
			overview: `Synopsis S2E${n}`,
			stillUrl: null
		}))
	];
};

describe('anime episodes from TMDB', () => {
	it('starts the run at the episode aired on the start date, across seasons', () => {
		// A split cour: the second part starts at TMDB S2E4
		const run = matchAnimeEpisodes(tmdbShow(), '2026-01-26', 3)!;
		expect(run.map((e) => [e.number, e.absoluteNumber, e.seasonNumber, e.title])).toEqual([
			[1, 1, null, 'S2E4'],
			[2, 2, null, 'S2E5'],
			[3, 3, null, 'S2E6']
		]);
		// Without a count, everything after the start; specials never count
		expect(matchAnimeEpisodes(tmdbShow(), '2025-01-05', null)!.map((e) => e.title)).toEqual([
			'S1E1',
			'S1E2',
			'S1E3',
			'S2E1',
			'S2E2',
			'S2E3',
			'S2E4',
			'S2E5',
			'S2E6'
		]);
	});

	it('opens the run with an episode 0 that TMDB files as a special', () => {
		const show = tmdbShow();
		show[0].airDate = new Date('2025-12-28T00:00:00Z'); // the special, a week before S2E1
		const run = matchAnimeEpisodes(show, '2025-12-28', 3)!;
		expect(run.map((e) => [e.number, e.title])).toEqual([
			[1, 'OAV'],
			[2, 'S2E1'],
			[3, 'S2E2']
		]);
	});

	it('gives up when no episode aired near the start date', () => {
		expect(matchAnimeEpisodes(tmdbShow(), '2026-01-08', 3)).toBeNull();
		expect(matchAnimeEpisodes([], '2026-01-04', 3)).toBeNull();
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

	it('syncs anime episodes from TMDB with the AniList schedule times, and keeps the match', async () => {
		const searches: string[] = [];
		const providers = {
			tv: {
				name: 'tmdb',
				client: {
					search: async (q: string) => {
						searches.push(q);
						return [
							{ externalId: `other-${run}`, anime: false, year: 2025 },
							{ externalId: `later-${run}`, anime: true, year: 2027 },
							{ externalId: `tmdb-${run}`, anime: true, year: 2025 }
						];
					},
					episodes: async (id: string) =>
						id === `tmdb-${run}` ? { upcomingOnly: false, seasons: [], episodes: tmdbShow() } : null
				}
			},
			anime: {
				name: 'anilist',
				client: {
					episodes: async () => ({
						upcomingOnly: true,
						seasons: [],
						episodes: [3, 4].map((n) => ({
							seasonNumber: null,
							number: n,
							absoluteNumber: n,
							title: null,
							airDate: new Date(`2027-02-0${n}T15:30:00Z`),
							runtimeMinutes: 24
						}))
					})
				}
			}
		} as unknown as Providers;
		const anime: ProviderMedia = {
			media: {
				type: 'anime',
				title: `Anime ${run} Season 2 Part 2`,
				status: 'releasing',
				startDate: '2026-01-25',
				totalUnits: 4,
				extra: { format: 'TV' }
			},
			externalIds: [{ provider: 'anilist', externalId: `test-${run}-anime` }],
			titles: [{ title: `Anime ${run} Season 2 Part 2`, locale: 'en' }]
		};
		const id = await upsertMedia(db, anime);
		created.media.push(id);

		expect(await syncEpisodes(db, providers, id)).toBe(4);
		expect(searches).toEqual([`anime ${run} season 2 part 2`]);
		const rows = await db
			.select()
			.from(episodes)
			.where(eq(episodes.mediaId, id))
			.orderBy(episodes.number);
		expect(rows.map((e) => [e.number, e.title, e.overview, e.airDate?.toISOString()])).toEqual([
			[1, 'S2E4', 'Synopsis S2E4', '2026-01-25T00:00:00.000Z'],
			[2, 'S2E5', 'Synopsis S2E5', '2026-02-01T00:00:00.000Z'],
			[3, 'S2E6', 'Synopsis S2E6', '2027-02-03T15:30:00.000Z'],
			[4, null, null, '2027-02-04T15:30:00.000Z'] // TMDB does not list it yet
		]);

		// The match survives a refresh from AniList and is reused without searching
		await upsertMedia(db, anime);
		const [row] = await db.select({ extra: media.extra }).from(media).where(eq(media.id, id));
		expect(row.extra).toEqual({ format: 'TV', tmdbId: `tmdb-${run}` });
		await syncEpisodes(db, providers, id);
		expect(searches).toHaveLength(1);

		// One group without season; marking it covers the aired episodes
		const userId = await newUser();
		const [group] = await seasonList(db, id, userId, null);
		expect([group.id, group.number, group.episodes.length]).toEqual([0, null, 4]);
		expect(await markSeason(db, userId, id, 0)).toBe(true);
		const [entry] = await db
			.select({ progress: libraryEntries.progress })
			.from(libraryEntries)
			.where(and(eq(libraryEntries.userId, userId), eq(libraryEntries.mediaId, id)));
		expect(entry.progress).toBe(2);
	});

	it('syncs a franchise season by season, lined up on the TMDB show', async () => {
		const providers = {
			tv: {
				name: 'tmdb',
				client: {
					search: async () => [{ externalId: `fr-${run}`, anime: true, year: 2025 }],
					episodes: async () => ({ upcomingOnly: false, seasons: [], episodes: tmdbShow() })
				}
			},
			anime: { name: 'anilist', client: { episodes: async () => null } },
			anilist: {
				schedules: async (ids: string[]) =>
					new Map([[ids[0], [{ episode: 4, airingAt: Date.parse('2027-02-04T15:30:00Z') / 1000 }]]])
			}
		} as unknown as Providers;
		const season = (number: number, airDate: string, episodeCount: number | null) => ({
			number,
			anilistId: `fr-${run}-${number}`,
			title: `Franchise ${run} ${number}`,
			airDate,
			status: episodeCount === null ? ('releasing' as const) : ('finished' as const),
			episodeCount,
			posterUrl: null
		});
		const id = await upsertMedia(db, {
			media: {
				type: 'anime',
				title: `Franchise ${run}`,
				status: 'releasing',
				runtimeMinutes: 23,
				totalUnitsSecondary: 3
			},
			externalIds: [{ provider: 'anilist', externalId: `fr-${run}-1` }],
			titles: [{ title: `Franchise ${run}`, locale: 'en' }],
			// Season 2 is the first cour of TMDB's season 2, season 3 the second (still airing)
			seasons: [
				season(1, '2025-01-05', 3),
				season(2, '2026-01-04', 3),
				season(3, '2026-01-25', null)
			]
		});
		created.media.push(id);

		expect(await syncEpisodes(db, providers, id)).toBe(10);
		const userId = await newUser();
		const list = await seasonList(db, id, userId, null);
		expect(
			list.map((s) => [s.number, s.episodes.map((e) => `${e.absolute}:${e.number}:${e.title}`)])
		).toEqual([
			[1, ['1:1:S1E1', '2:2:S1E2', '3:3:S1E3']],
			[2, ['4:1:S2E1', '5:2:S2E2', '6:3:S2E3']],
			[3, ['7:1:S2E4', '8:2:S2E5', '9:3:S2E6', '10:4:null']]
		]);
		const [last] = await db
			.select({ airDate: episodes.airDate, runtime: episodes.runtimeMinutes })
			.from(episodes)
			.where(and(eq(episodes.mediaId, id), eq(episodes.absoluteNumber, 10)));
		expect(last).toEqual({ airDate: new Date('2027-02-04T15:30:00Z'), runtime: 23 });

		// Marking the last episode of season 2 covers everything before it
		expect(await markSeason(db, userId, id, list[1].id)).toBe(true);
		const [entry] = await db
			.select({ progress: libraryEntries.progress })
			.from(libraryEntries)
			.where(and(eq(libraryEntries.userId, userId), eq(libraryEntries.mediaId, id)));
		expect(entry.progress).toBe(6);
	});

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
	it('marks episodes "seen up to here", by season, and specials on their own', async () => {
		const id = await newMedia(9, { totalUnits: 4 });
		const userId = await newUser();
		const day = 24 * 3600 * 1000;
		const ep = (season: number, number: number, absoluteNumber: number | null, inDays: number) => ({
			seasonNumber: season,
			number,
			absoluteNumber,
			title: null,
			airDate: new Date(Date.now() + inDays * day),
			runtimeMinutes: 30
		});
		await storeEpisodes(db, id, {
			upcomingOnly: false,
			seasons: [0, 1, 2].map((number) => ({
				number,
				title: null,
				airDate: null,
				episodeCount: null,
				posterUrl: null
			})),
			episodes: [
				ep(0, 1, null, -9),
				ep(1, 1, 1, -9),
				ep(1, 2, 2, -8),
				ep(2, 1, 3, -2),
				ep(2, 2, 4, 5)
			]
		});
		const state = async () => {
			const [entry] = await db
				.select()
				.from(libraryEntries)
				.where(and(eq(libraryEntries.userId, userId), eq(libraryEntries.mediaId, id)));
			const list = await seasonList(db, id, userId, entry);
			return { entry, seen: list.map((s) => s.episodes.map((e) => +e.seen).join('')).join(' ') };
		};
		const byNumber = async (season: number, number: number) =>
			(await seasonList(db, id, userId, null))
				.find((s) => s.number === season)!
				.episodes.find((e) => e.number === number)!.id;

		// Seasons in order, specials last; S1E2 marks S1E1 too, and is kept on the journal event
		const s1e2 = await byNumber(1, 2);
		expect(await markEpisode(db, userId, id, s1e2, true)).toBe(true);
		let s = await state();
		expect(s.entry).toMatchObject({ progress: 2, status: 'in_progress' });
		expect(s.seen).toBe('11 00 0');
		const [event] = await db
			.select({ episodeId: activityEvents.episodeId, amount: activityEvents.amount })
			.from(activityEvents)
			.where(and(eq(activityEvents.userId, userId), eq(activityEvents.kind, 'episode')));
		expect(event).toEqual({ episodeId: s1e2, amount: 2 });
		const views = () => db.select().from(episodeViews).where(eq(episodeViews.userId, userId));
		expect(await views()).toHaveLength(2);

		// A season: its aired episodes only; an earlier episode never moves progress back
		const season2 = (await seasonList(db, id, userId, null)).find((x) => x.number === 2)!.id;
		await markSeason(db, userId, id, season2);
		expect((await state()).entry.progress).toBe(3);
		await markEpisode(db, userId, id, await byNumber(1, 1), true);
		expect((await state()).entry.progress).toBe(3);

		// Unseen goes back to the episode before, and drops the later views
		await markEpisode(db, userId, id, s1e2, false);
		s = await state();
		expect(s.entry.progress).toBe(1);
		expect(s.seen).toBe('10 00 0');
		expect(await views()).toHaveLength(1);

		// Specials: toggled alone, progress untouched
		const special = await byNumber(0, 1);
		await markEpisode(db, userId, id, special, true);
		await markEpisode(db, userId, id, special, true);
		s = await state();
		expect(s.seen).toBe('10 00 1');
		expect(s.entry.progress).toBe(1);
		expect(await views()).toHaveLength(2);
		await markEpisode(db, userId, id, special, false);
		expect((await state()).seen).toBe('10 00 0');

		// Another media's episode is refused
		expect(await markEpisode(db, userId, await newMedia(10), s1e2, true)).toBe(false);
	});

	it('builds the episode page and rates episodes with the entry visibility', async () => {
		const id = await newMedia(11);
		await storeEpisodes(db, id, {
			upcomingOnly: false,
			seasons: [{ number: 1, title: null, airDate: null, episodeCount: 2, posterUrl: null }],
			episodes: [1, 2].map((n) => ({
				seasonNumber: 1,
				number: n,
				absoluteNumber: n,
				title: `E${n}`,
				airDate: new Date('2026-01-01T00:00:00Z'),
				runtimeMinutes: 40,
				overview: n === 1 ? 'Synopsis' : null,
				stillUrl: null
			}))
		});
		const [alice, bob] = [await newUser(), await newUser()];
		const [e1, e2] = (await seasonList(db, id, alice, null))[0].episodes.map((e) => e.id);

		expect(await rateEpisode(db, alice, id, e1, 80)).toBe(true);
		await rateEpisode(db, alice, id, e1, 60); // one score per user and episode
		await rateEpisode(db, bob, id, e1, 100);
		expect(await rateEpisode(db, alice, await newMedia(12), e1, 50)).toBe(false);

		// The season list carries each episode's visible average
		const listed = (await seasonList(db, id, alice, null))[0];
		expect(listed.episodes.map((e) => e.average)).toEqual([80, null]);
		expect(listed.seen).toBe(0);

		let page = (await episodePage(db, id, e1, alice, null))!;
		expect(page).toMatchObject({
			label: 'S1E1',
			overview: 'Synopsis',
			stale: false,
			myScore: 60,
			previous: null,
			next: { id: e2, label: 'S1E2' },
			community: { count: 2, average: 80 }
		});

		// Bob hides his entry: his score leaves Alice's view, not his own
		await db.update(libraryEntries).set({ isPrivate: true }).where(eq(libraryEntries.userId, bob));
		page = (await episodePage(db, id, e1, alice, null))!;
		expect(page.community).toMatchObject({ count: 1, average: 60 });
		expect((await episodePage(db, id, e1, bob, null))!.community.count).toBe(2);

		await rateEpisode(db, alice, id, e1, null);
		expect((await episodePage(db, id, e1, alice, null))!.myScore).toBeNull();
		expect((await episodePage(db, id, e2, alice, null))!.previous?.id).toBe(e1);
		expect(await episodePage(db, await newMedia(13), e1, alice, null)).toBeNull();
	});
});
