import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { storeEpisodes, upsertMedia } from './catalogue';
import { createDb } from './db';
import {
	activityEvents,
	episodes,
	episodeViews,
	libraryEntries,
	listItems,
	lists,
	media,
	mediaExternalIds,
	users
} from './db/schema';
import { mergeEntries, mergeSeasons, type SeasonEntry } from './franchises';

const entry = (over: Partial<SeasonEntry['entry']> = {}): SeasonEntry['entry'] => ({
	status: 'planned',
	score: null,
	progress: 0,
	repeatCount: 0,
	startedOn: null,
	completedOn: null,
	review: null,
	reviewSpoiler: false,
	notes: null,
	isFavorite: false,
	isPrivate: false,
	...over
});
// Three seasons of 12: ends at 12, 24, 36; the third one airing (30 aired)
const franchise = { aired: 30, total: 36, seasonEnds: [12, 24, 36] };
const part = (season: number, over: Partial<SeasonEntry['entry']>) => ({
	season,
	offset: (season - 1) * 12,
	count: 12,
	entry: entry(over)
});

describe('merging season entries', () => {
	it('goes as far as the last season started, earlier ones counted as seen', () => {
		const merged = mergeEntries(
			[
				part(1, {
					status: 'completed',
					progress: 12,
					score: 80,
					startedOn: '2024-01-01',
					completedOn: '2024-02-01'
				}),
				part(2, { status: 'in_progress', progress: 5, score: 60, startedOn: '2024-06-01' })
			],
			franchise
		);
		expect(merged).toMatchObject({
			status: 'in_progress',
			progress: 17,
			progressSecondary: 1,
			score: 60, // the latest season rated
			startedOn: '2024-01-01',
			completedOn: null,
			notes: 'Saison 1 : 80/100'
		});
	});

	it('completes the franchise once everything aired is seen', () => {
		const merged = mergeEntries(
			[
				part(2, { status: 'completed', progress: 12, completedOn: '2024-03-01' }),
				part(3, { status: 'in_progress', progress: 6, completedOn: null })
			],
			franchise
		);
		expect(merged).toMatchObject({
			status: 'completed',
			progress: 30,
			progressSecondary: 2,
			completedOn: '2024-03-01'
		});
	});

	it('keeps a finished season as in progress while a later one is out', () => {
		const merged = mergeEntries([part(1, { status: 'completed', progress: 12 })], franchise);
		expect(merged).toMatchObject({ status: 'in_progress', progress: 12 });
	});

	it('stays planned when nothing started, and keeps every text', () => {
		const merged = mergeEntries(
			[
				part(1, { review: 'Bien', isFavorite: true }),
				part(2, { notes: 'À voir', isPrivate: true, repeatCount: 2 })
			],
			franchise
		);
		expect(merged).toMatchObject({
			status: 'planned',
			progress: 0,
			review: 'Saison 1 :\nBien',
			notes: 'Saison 2 :\nÀ voir',
			isFavorite: true,
			isPrivate: true,
			repeatCount: 2
		});
	});
});

// Integration: needs a migrated database (pnpm db:up && pnpm db:migrate).
describe('merging season works into their franchise', () => {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set');
	const db = createDb(url);
	const run = randomUUID().slice(0, 8);
	const created = { users: [] as string[], media: [] as number[] };

	afterAll(async () => {
		await db.delete(users).where(inArray(users.id, created.users));
		await db.delete(activityEvents).where(inArray(activityEvents.mediaId, created.media));
		await db.delete(libraryEntries).where(inArray(libraryEntries.mediaId, created.media));
		await db.delete(media).where(inArray(media.id, created.media));
		await db.$client.end();
	});

	it('moves entries, journal, views, lists and ids, then deletes the season work', async () => {
		const anilist = (n: number) => `fr-${run}-${n}`;
		// Before franchises: season 1 and season 2 were two works, with episodes without season
		const old = async (n: number) => {
			const id = await upsertMedia(db, {
				media: { type: 'anime', title: `Old ${run} ${n}`, totalUnits: 3, extra: { format: 'TV' } },
				externalIds: [{ provider: 'anilist', externalId: anilist(n) }],
				titles: [{ title: `Old ${run} ${n}`, locale: 'en' }]
			});
			created.media.push(id);
			await storeEpisodes(db, id, {
				upcomingOnly: false,
				seasons: [],
				episodes: [1, 2, 3].map((number) => ({
					seasonNumber: null,
					number,
					absoluteNumber: number,
					title: null,
					airDate: null,
					runtimeMinutes: 24
				}))
			});
			return id;
		};
		const s1 = await old(1);
		const s2 = await old(2);
		const episodeOf = async (mediaId: number, number: number) =>
			(
				await db
					.select({ id: episodes.id })
					.from(episodes)
					.where(and(eq(episodes.mediaId, mediaId), eq(episodes.number, number)))
			)[0].id;

		const [{ id: userId }] = await db
			.insert(users)
			.values({ email: `fr-${run}@test.vulu`, username: `fr_${run}` })
			.returning({ id: users.id });
		created.users.push(userId);
		await db.insert(libraryEntries).values([
			{ userId, mediaId: s1, status: 'completed', progress: 3, score: 70 },
			{ userId, mediaId: s2, status: 'in_progress', progress: 1, score: 90 }
		]);
		const s2e1 = await episodeOf(s2, 1);
		await db.insert(episodeViews).values({ userId, episodeId: s2e1 });
		await db
			.insert(activityEvents)
			.values({ userId, mediaId: s2, kind: 'episode', amount: 1, episodeId: s2e1 });
		const [list] = await db
			.insert(lists)
			.values({ userId, name: `List ${run}` })
			.returning({ id: lists.id });
		await db.insert(listItems).values({ listId: list.id, mediaId: s2, position: 0 });

		// The refresh turns season 1's work into the franchise (same primary id)
		const season = (number: number) => ({
			number,
			anilistId: anilist(number),
			title: `Old ${run} ${number}`,
			airDate: null,
			status: 'finished' as const,
			episodeCount: 3,
			posterUrl: null
		});
		const franchise = await upsertMedia(db, {
			media: { type: 'anime', title: `Old ${run} 1`, totalUnits: 6, totalUnitsSecondary: 2 },
			externalIds: [
				{ provider: 'anilist', externalId: anilist(1) },
				{ provider: 'anilist', externalId: anilist(2) }
			],
			titles: [],
			seasons: [season(1), season(2)]
		});
		expect(franchise).toBe(s1);
		await storeEpisodes(db, franchise, {
			upcomingOnly: false,
			seasons: [season(1), season(2)],
			episodes: [1, 2].flatMap((s) =>
				[1, 2, 3].map((number) => ({
					seasonNumber: s,
					number,
					absoluteNumber: (s - 1) * 3 + number,
					title: null,
					airDate: null,
					runtimeMinutes: 24
				}))
			)
		});

		expect(await mergeSeasons(db, franchise)).toBe(1);
		expect(await mergeSeasons(db, franchise)).toBe(0); // idempotent

		expect((await db.select().from(media).where(eq(media.id, s2))).length).toBe(0);
		const entries = await db.select().from(libraryEntries).where(eq(libraryEntries.userId, userId));
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			mediaId: franchise,
			status: 'in_progress',
			progress: 4,
			progressSecondary: 1,
			score: 90,
			notes: 'Saison 1 : 70/100'
		});
		// Season 2, episode 1 of the franchise inherits the view and the journal
		const [newEpisode] = await db
			.select({ id: episodes.id, absolute: episodes.absoluteNumber })
			.from(episodes)
			.innerJoin(episodeViews, eq(episodeViews.episodeId, episodes.id))
			.where(eq(episodeViews.userId, userId));
		expect(newEpisode.absolute).toBe(4);
		const [event] = await db
			.select({ mediaId: activityEvents.mediaId, episodeId: activityEvents.episodeId })
			.from(activityEvents)
			.where(eq(activityEvents.userId, userId));
		expect(event).toEqual({ mediaId: franchise, episodeId: newEpisode.id });
		const items = await db.select().from(listItems).where(eq(listItems.listId, list.id));
		expect(items.map((i) => i.mediaId)).toEqual([franchise]);
		const ids = await db
			.select({ externalId: mediaExternalIds.externalId, isPrimary: mediaExternalIds.isPrimary })
			.from(mediaExternalIds)
			.where(eq(mediaExternalIds.mediaId, franchise));
		expect(ids).toEqual(
			expect.arrayContaining([
				{ externalId: anilist(1), isPrimary: true },
				{ externalId: anilist(2), isPrimary: false }
			])
		);
		// Season 1's own episodes without season are gone, all numbered ones have a season
		const loose = await db
			.select()
			.from(episodes)
			.where(and(eq(episodes.mediaId, franchise), eq(episodes.number, 1)));
		expect(loose.every((e) => e.seasonId !== null)).toBe(true);
	});
});
