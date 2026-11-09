import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from './db';
import { media, users } from './db/schema';
import { popularOnVulu, rankRecommendations } from './discover';
import { addToLibrary, updateEntry } from './library';
import type { SearchResult } from './providers/types';

const r = (id: string, over: Partial<SearchResult> = {}): SearchResult => ({
	provider: 'tmdb',
	externalId: id,
	type: 'movie',
	title: `Film ${id}`,
	originalTitle: null,
	year: null,
	posterUrl: null,
	isAdult: false,
	...over
});

describe('rankRecommendations', () => {
	it('ranks works recommended by several seeds first, without owned or adult ones', () => {
		const ranked = rankRecommendations(
			[
				{ seed: 'A', results: [r('1'), r('2'), r('3'), r('x', { isAdult: true })] },
				{ seed: 'B', results: [r('4'), r('3'), r('owned')] }
			],
			new Set(['tmdb:owned'])
		);
		expect(ranked.map((x) => [x.externalId, x.because])).toEqual([
			['3', 'A'],
			['1', 'A'],
			['4', 'B'],
			['2', 'A']
		]);
	});
});

// Integration: needs a migrated database (pnpm db:up && pnpm db:migrate).
describe('popularOnVulu', () => {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set');
	const db = createDb(url);
	const run = randomUUID().slice(0, 8);
	const created = { users: [] as string[], media: [] as number[] };

	afterAll(async () => {
		await db.delete(users).where(inArray(users.id, created.users));
		await db.delete(media).where(inArray(media.id, created.media));
		await db.$client.end();
	});

	it('counts distinct active members per work this week', async () => {
		const people = await db
			.insert(users)
			.values(
				['a', 'b', 'c'].map((n) => ({
					email: `pop_${run}_${n}@test.vulu`,
					username: `pop_${run}_${n}`
				}))
			)
			.returning({ id: users.id });
		const films = await db
			.insert(media)
			.values(['Hit', 'Niche'].map((t) => ({ type: 'movie' as const, title: `${t} ${run}` })))
			.returning({ id: media.id });
		created.users.push(...people.map((p) => p.id));
		created.media.push(...films.map((f) => f.id));
		const [hit, niche] = films.map((f) => f.id);

		for (const [p, m] of [
			[people[0], hit],
			[people[1], hit],
			[people[2], niche]
		] as const) {
			await updateEntry(db, p.id, await addToLibrary(db, p.id, m), { status: 'completed' });
		}
		const rows = (await popularOnVulu(db, people[0].id, 1000)).filter((x) =>
			created.media.includes(x.mediaId)
		);
		expect(rows.map((x) => [x.mediaId, x.members])).toEqual([
			[hit, 2],
			[niche, 1]
		]);
	});
});
