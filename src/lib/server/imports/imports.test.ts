import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { airingWithoutEpisodes, upsertMedia, type Providers } from '../catalogue';
import { createDb } from '../db';
import { activityEvents, importJobs, libraryEntries, media, users } from '../db/schema';
import { createAniListClient } from '../providers/anilist';
import type { Fetch } from '../providers/http';
import { createOpenLibraryClient } from '../providers/openlibrary';
import type { ProviderMedia } from '../providers/types';
import { parseCsv, parseGoodreads } from './goodreads';
import { runImport } from './run';
import type { ImportItem } from './types';

const noWait = async () => {};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('CSV', () => {
	it('handles quotes, commas, line breaks and CRLF', () => {
		expect(parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\r\n\r\n')).toEqual([
			['a', 'b'],
			['x, y', 'say "hi"\nthere']
		]);
	});
});

describe('Goodreads export', () => {
	const csv = [
		'﻿Book Id,Title,Author,ISBN,ISBN13,My Rating,Number of Pages,Date Read,Exclusive Shelf,My Review,Private Notes,Read Count',
		'1,"Dune (Dune, #1)",Frank Herbert,"=""0441172717""","=""9780441172719""",5,658,2024/03/09,read,"Great, really.",,2',
		'2,Project Hail Mary,Andy Weir,"=""""","=""""",0,476,,currently-reading,,mine,0',
		'3,Some Book,Someone,,,0,,,favorites,,,0'
	].join('\n');

	it('maps shelves, ratings, dates and ISBNs', () => {
		const [dune, hail, other] = parseGoodreads(csv);
		expect(dune).toMatchObject({
			label: 'Dune (Dune, #1) — Frank Herbert',
			type: 'book',
			lookup: {
				isbn13: '9780441172719',
				isbn: '0441172717',
				title: 'Dune',
				author: 'Frank Herbert'
			},
			entry: {
				status: 'completed',
				progress: 658,
				score: 100,
				completedOn: '2024-03-09',
				repeatCount: 1,
				review: 'Great, really.'
			}
		});
		expect(hail.lookup).toMatchObject({ isbn13: undefined, isbn: undefined });
		expect(hail.entry).toMatchObject({
			status: 'in_progress',
			progress: 0,
			score: null,
			notes: 'mine'
		});
		expect(other.entry.status).toBe('planned');
	});

	it('rejects a file that is not a Goodreads export', () => {
		expect(() => parseGoodreads('name,age\nbob,3')).toThrow('export Goodreads');
	});
});

describe('AniList user lists', () => {
	const media = (id: number) => ({
		id,
		idMal: null,
		type: 'ANIME',
		format: 'TV',
		status: 'FINISHED',
		title: { romaji: `Romaji ${id}`, english: null, native: null },
		synonyms: [],
		description: null,
		startDate: { year: 2020, month: null, day: null },
		endDate: null,
		episodes: 12,
		duration: 24,
		chapters: null,
		volumes: null,
		coverImage: null,
		bannerImage: null,
		genres: [],
		isAdult: false,
		studios: { nodes: [] }
	});
	const entry = (id: number, over = {}) => ({
		status: 'COMPLETED',
		score: 85,
		progress: 12,
		progressVolumes: null,
		repeat: 0,
		notes: '',
		startedAt: { year: 2023, month: 1, day: 2 },
		completedAt: { year: 2023, month: 2, day: null },
		media: media(id),
		...over
	});

	it('reads every chunk, skips custom lists and unrated scores', async () => {
		const calls: number[] = [];
		const fetch: Fetch = async (_url, init) => {
			const { chunk } = JSON.parse(String(init?.body)).variables;
			calls.push(chunk);
			const lists =
				chunk === 1
					? [
							{
								isCustomList: false,
								entries: [entry(1), entry(2, { status: 'CURRENT', score: 0 })]
							},
							{ isCustomList: true, entries: [entry(1)] }
						]
					: [{ isCustomList: false, entries: [entry(3, { status: 'PLANNING' })] }];
			return json({ data: { MediaListCollection: { hasNextChunk: chunk === 1, lists } } });
		};
		const items = await createAniListClient({ fetch, limiter: noWait }).userList(
			'someone',
			'anime'
		);

		expect(calls).toEqual([1, 2]);
		expect(items?.map((i) => [i.label, i.entry.status, i.entry.score])).toEqual([
			['Romaji 1', 'completed', 85],
			['Romaji 2', 'in_progress', null],
			['Romaji 3', 'planned', 85]
		]);
		expect(items?.[0].entry).toMatchObject({ startedOn: '2023-01-02', completedOn: '2023-02-01' });
		expect(items?.[0].media?.externalIds).toEqual([{ provider: 'anilist', externalId: '1' }]);
	});

	it('returns null for a private or unknown profile', async () => {
		const fetch: Fetch = async () =>
			json(
				{ errors: [{ message: 'Private User', status: 404 }], data: { MediaListCollection: null } },
				404
			);
		expect(await createAniListClient({ fetch, limiter: noWait }).userList('x', 'manga')).toBeNull();
	});
});

describe('Open Library lookup', () => {
	it('tries the ISBN first, then title and author', async () => {
		const queries: string[] = [];
		const fetch: Fetch = async (url) => {
			const q = new URL(String(url)).searchParams.get('q')!;
			queries.push(q);
			const docs = q.startsWith('title:')
				? [
						{
							key: '/works/OL1W',
							title: 'Dune',
							author_name: ['Frank Herbert'],
							number_of_pages_median: 600
						}
					]
				: [];
			return json({ docs });
		};
		const found = await createOpenLibraryClient({ fetch, limiter: noWait }).lookup!({
			isbn13: '9780441172719',
			title: 'Dune: Deluxe!',
			author: 'Frank Herbert'
		});
		expect(queries).toEqual(['isbn:9780441172719', 'title:(Dune  Deluxe) author:(Frank Herbert)']);
		expect(found?.externalIds).toEqual([{ provider: 'openlibrary', externalId: 'OL1W' }]);
		expect(found?.media).toMatchObject({ title: 'Dune', totalUnits: 600 });
	});
});

// Integration: needs a migrated database (pnpm db:up && pnpm db:migrate).
describe('runImport', () => {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set');
	const db = createDb(url);
	const run = randomUUID().slice(0, 8);
	let userId = '';
	const mediaIds: number[] = [];

	const anime = (n: number): ProviderMedia => ({
		media: {
			type: 'anime',
			title: `Anime ${run} ${n}`,
			status: n === 1 ? 'releasing' : 'finished',
			totalUnits: 12,
			runtimeMinutes: 24
		},
		externalIds: [{ provider: 'anilist', externalId: `test-${run}-${n}` }],
		titles: []
	});
	const entry = {
		status: 'completed' as const,
		progress: 12,
		progressSecondary: 0,
		score: 80,
		startedOn: null,
		completedOn: '2024-05-01',
		repeatCount: 0,
		review: null,
		notes: null
	};
	const providers = {
		book: {
			name: 'openlibrary',
			client: {
				types: ['book'],
				search: async () => [],
				get: async () => null,
				lookup: async ({ title }: { title: string }) =>
					title === 'Known'
						? {
								media: { type: 'book', title: `Book ${run}` },
								externalIds: [{ provider: 'openlibrary', externalId: `test-${run}-book` }],
								titles: []
							}
						: null
			}
		}
	} as unknown as Providers;

	afterAll(async () => {
		const ids = await db
			.select({ id: libraryEntries.mediaId })
			.from(libraryEntries)
			.where(eq(libraryEntries.userId, userId));
		await db.delete(users).where(eq(users.id, userId));
		await db.delete(media).where(inArray(media.id, [...mediaIds, ...ids.map((i) => i.id)]));
		await db.$client.end();
	});

	it('adds new entries, keeps existing ones, lists unmatched rows and can be replayed', async () => {
		[{ id: userId }] = await db
			.insert(users)
			.values({ email: `imp-${run}@test.vulu`, username: `imp_${run}` })
			.returning({ id: users.id });
		const items: ImportItem[] = [
			{ label: 'A1', type: 'anime', media: anime(1), entry },
			{ label: 'A2', type: 'anime', media: anime(2), entry },
			{
				label: 'Known',
				type: 'book',
				lookup: { title: 'Known' },
				entry: { ...entry, progress: 300 }
			},
			{ label: 'Lost — Nobody', type: 'book', lookup: { title: 'Lost' }, entry }
		];
		const newJob = async () =>
			(
				await db
					.insert(importJobs)
					.values({ userId, source: 'anilist' })
					.returning({ id: importJobs.id })
			)[0].id;

		// The user already follows A2, differently
		const a2 = await upsertMedia(db, anime(2));
		mediaIds.push(a2);
		await db.insert(libraryEntries).values({ userId, mediaId: a2, status: 'paused', progress: 3 });

		const importId = await newJob();
		const stats = await runImport(db, providers, { importId, userId, source: 'anilist', items });
		expect(stats).toEqual({ total: 4, imported: 2, kept: 1, unmatched: 1 });

		const [job] = await db.select().from(importJobs).where(eq(importJobs.id, importId));
		expect(job.status).toBe('done');
		expect(job.unmatched).toEqual([{ label: 'Lost — Nobody', type: 'book', reason: 'not_found' }]);

		const entries = await db.select().from(libraryEntries).where(eq(libraryEntries.userId, userId));
		expect(entries.find((e) => e.mediaId === a2)).toMatchObject({ status: 'paused', progress: 3 });

		const events = await db.select().from(activityEvents).where(eq(activityEvents.userId, userId));
		const a1Events = events.filter((e) => e.mediaId !== a2 && e.amount === 12);
		expect(a1Events[0]).toMatchObject({ kind: 'episode', minutes: 288, source: 'import' });
		expect(a1Events[0].occurredAt.toISOString().slice(0, 10)).toBe('2024-05-01');

		// The airing anime (A1) is queued for an episode sync, the finished one is not
		const a1 = entries.find((e) => e.mediaId !== a2 && e.progress === 12)!.mediaId;
		expect(await airingWithoutEpisodes(db, userId)).toEqual([a1]);

		// Replaying the same import changes nothing
		await runImport(db, providers, { importId: await newJob(), userId, source: 'anilist', items });
		const after = await db.select().from(activityEvents).where(eq(activityEvents.userId, userId));
		expect(after).toHaveLength(events.length);
	});
});
