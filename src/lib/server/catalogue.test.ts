import { randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importMedia, searchProvider, upsertMedia, type Providers } from './catalogue';
import { createDb } from './db';
import { media, mediaExternalIds, mediaTitles, providerCache } from './db/schema';
import { requestJob } from './jobs';
import type { ProviderClient, ProviderMedia } from './providers/types';

// Integration test: needs a migrated database (pnpm db:up && pnpm db:migrate).
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const db = createDb(url);

// Ids unique to this run, so nothing collides with seed or real data.
const run = randomUUID().slice(0, 8);
const id = (n: number) => `test-${run}-${n}`;

const book = (
	externalId: string,
	title: string,
	extraIds: ProviderMedia['externalIds'] = []
): ProviderMedia => ({
	media: { type: 'book', title, status: 'finished' },
	externalIds: [{ provider: 'openlibrary', externalId }, ...extraIds],
	titles: [{ title, locale: null }]
});

/** Fake provider client counting its calls. */
function fakeClient() {
	const calls = { search: 0, get: 0 };
	const client: ProviderClient = {
		types: ['book'],
		search: async (q) => {
			calls.search++;
			return [
				{
					provider: 'openlibrary',
					externalId: id(9),
					type: 'book',
					title: q,
					originalTitle: null,
					year: null,
					posterUrl: null,
					isAdult: false
				}
			];
		},
		get: async (externalId) => {
			calls.get++;
			return externalId === id(404) ? null : book(externalId, `Book ${externalId}`);
		}
	};
	const providers = { book: { name: 'openlibrary', client } } as Providers;
	return { providers, calls };
}

// Remove everything this run created (deleting media cascades to ids and titles).
afterAll(async () => {
	const created = db
		.select({ id: mediaExternalIds.mediaId })
		.from(mediaExternalIds)
		.where(like(mediaExternalIds.externalId, `test-${run}-%`));
	await db.delete(media).where(inArray(media.id, created));
	await db.delete(providerCache).where(like(providerCache.key, `%${run}%`));
	await db.$client.end();
});

describe('upsertMedia', () => {
	it('creates a media once and refreshes it on re-import', async () => {
		const first = await upsertMedia(db, book(id(1), 'Old title'));
		const again = await upsertMedia(db, book(id(1), 'New title'));
		expect(again).toBe(first);

		const [row] = await db.select().from(media).where(eq(media.id, first));
		expect(row.title).toBe('New title');
		const titles = await db
			.select({ title: mediaTitles.title })
			.from(mediaTitles)
			.where(eq(mediaTitles.mediaId, first));
		expect(titles.map((t) => t.title).sort()).toEqual(['New title', 'Old title']);
	});

	it('keeps a secondary id that already belongs to another media', async () => {
		const owner = await upsertMedia(
			db,
			book(id(2), 'Owner', [{ provider: 'isbn13', externalId: id(20) }])
		);
		const other = await upsertMedia(
			db,
			book(id(3), 'Other', [{ provider: 'isbn13', externalId: id(20) }])
		);
		const [isbn] = await db
			.select()
			.from(mediaExternalIds)
			.where(eq(mediaExternalIds.externalId, id(20)));
		expect(isbn.mediaId).toBe(owner);
		expect(other).not.toBe(owner);
	});

	it('does not create duplicates under concurrent imports', async () => {
		const ids = await Promise.all([1, 2, 3].map(() => upsertMedia(db, book(id(4), 'Race'))));
		expect(new Set(ids).size).toBe(1);
	});
});

describe('provider cache', () => {
	it('serves repeated searches and imports from the cache', async () => {
		const { providers, calls } = fakeClient();
		const q = `Query ${run}`;
		expect(await searchProvider(db, providers, 'book', q)).toHaveLength(1);
		await searchProvider(db, providers, 'book', `  ${q.toUpperCase()} `);
		expect(calls.search).toBe(1);

		const mediaId = await importMedia(db, providers, 'book', id(5));
		expect(await importMedia(db, providers, 'book', id(5))).toBe(mediaId);
		expect(calls.get).toBe(1);

		expect(await importMedia(db, providers, 'book', id(404))).toBeNull();
	});
});

describe('requestJob', () => {
	const boss = new PgBoss(url);
	const queue = `test-${run}`;

	beforeAll(async () => {
		await boss.start();
		await boss.createQueue(queue);
		await boss.work<{ n: number }>(queue, async ([job]) => {
			if (job.data.n < 0) throw new Error('negative');
			return { double: job.data.n * 2 };
		});
	});
	afterAll(async () => {
		await boss.deleteQueue(queue);
		await boss.stop({ graceful: false });
	});

	it('returns the output computed by the worker', async () => {
		expect(await requestJob(boss, queue, { n: 21 })).toEqual({ double: 42 });
	});

	it('throws when the job fails', async () => {
		await expect(requestJob(boss, queue, { n: -1 })).rejects.toThrow('negative');
	});
});
