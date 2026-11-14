import { randomUUID } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { Providers } from '../catalogue';
import { createDb } from '../db';
import { libraryEntries, media, users } from '../db/schema';
import type { ProviderMedia } from '../providers/types';
import { parseLetterboxd, readLetterboxdFiles } from './letterboxd';
import { runImport } from './run';

/** A minimal ZIP archive, deflated, as Letterboxd serves it. */
function zipOf(files: Record<string, string>) {
	const parts: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	for (const [name, text] of Object.entries(files)) {
		const data = deflateRawSync(text);
		const n = Buffer.from(name);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(8, 8);
		local.writeUInt16LE(n.length, 26);
		const entry = Buffer.alloc(46);
		entry.writeUInt32LE(0x02014b50, 0);
		entry.writeUInt16LE(8, 10);
		entry.writeUInt32LE(data.length, 20);
		entry.writeUInt16LE(n.length, 28);
		entry.writeUInt32LE(offset, 42);
		parts.push(local, n, data);
		central.push(entry, n);
		offset += 30 + n.length + data.length;
	}
	const dir = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(files).length, 10);
	end.writeUInt32LE(dir.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...parts, dir, end]);
}

const files = {
	'watchlist.csv': 'Date,Name,Year,Letterboxd URI\n2024-01-01,Later,2022,https://boxd.it/a\n',
	'watched.csv':
		'Date,Name,Year,Letterboxd URI\n2024-02-01,Dune,2021,https://boxd.it/b\n2024-02-02,"Seen, Once",2019,https://boxd.it/c\n',
	'diary.csv':
		'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n' +
		'2024-02-01,Dune,2021,https://boxd.it/x1,4.5,,,2021-10-22\n' +
		'2024-03-01,Dune,2021,https://boxd.it/x2,5,Yes,,2024-03-01\n',
	'ratings.csv':
		'Date,Name,Year,Letterboxd URI,Rating\n2024-03-01,Dune,2021,https://boxd.it/b,4.5\n2024-04-01,Rated only,2010,https://boxd.it/d,0.5\n'
};

describe('Letterboxd export', () => {
	it('merges watchlist, watched, diary and ratings into one row per film', async () => {
		const zip = zipOf({ ...files, 'deleted/watched.csv': 'ignored', 'profile.csv': 'x' });
		const items = parseLetterboxd(await readLetterboxdFiles([new File([zip], 'export.zip')]));
		const byLabel = Object.fromEntries(items.map((i) => [i.label, i]));

		expect(items).toHaveLength(4);
		expect(byLabel['Later (2022)']).toMatchObject({
			type: 'movie',
			search: { title: 'Later', year: 2022 },
			entry: { status: 'planned' }
		});
		expect(byLabel['Dune (2021)'].entry).toMatchObject({
			status: 'completed',
			completedOn: '2024-03-01', // latest diary entry
			repeatCount: 1,
			score: 90
		});
		expect(byLabel['Seen, Once (2019)'].entry).toMatchObject({
			status: 'completed',
			completedOn: '2024-02-02', // no diary entry: the day it was marked seen
			score: null
		});
		expect(byLabel['Rated only (2010)'].entry).toMatchObject({ status: 'completed', score: 10 });
	});

	it('accepts the CSV files themselves and rejects other files', async () => {
		const csv = new File([files['ratings.csv']], 'ratings.csv');
		expect(parseLetterboxd(await readLetterboxdFiles([csv]))).toHaveLength(2);
		const other = new File(['a,b\n1,2'], 'other.csv');
		await expect(readLetterboxdFiles([other]).then(parseLetterboxd)).rejects.toThrow(
			/Aucun fichier Letterboxd/
		);
	});
});

// Integration: needs a migrated database (pnpm db:up && pnpm db:migrate).
describe('runImport with title and year', () => {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set');
	const db = createDb(url);
	const run = randomUUID().slice(0, 8);
	let userId = '';

	afterAll(async () => {
		const ids = await db
			.select({ id: libraryEntries.mediaId })
			.from(libraryEntries)
			.where(eq(libraryEntries.userId, userId));
		await db.delete(users).where(eq(users.id, userId));
		await db.delete(media).where(
			inArray(
				media.id,
				ids.map((i) => i.id)
			)
		);
		await db.$client.end();
	});

	it('matches the same title within a year, then a show, then a longer title', async () => {
		[{ id: userId }] = await db
			.insert(users)
			.values({ email: `lbx-${run}@test.vulu`, username: `lbx_${run}` })
			.returning({ id: users.id });
		const t = (name: string) => `${name} ${run}`;
		const result = (type: string, title: string, year: number, votes: number) => ({
			provider: 'tmdb',
			externalId: `test-${run}-${type}-${title.split(' ')[0]}-${year}-${votes}`,
			type,
			title,
			year,
			votes
		});
		// What TMDB answers per (English) query, whatever the year asked
		const movies: Record<string, unknown[]> = {
			[t('Box')]: [
				result('movie', t('Box'), 2021, 5), // most relevant, but obscure
				result('movie', t('Box'), 1984, 9999), // famous, wrong decade
				result('movie', t('Box Story'), 2021, 8000), // other title
				result('movie', t('Box'), 2020, 1500) // festival a year earlier: the one
			],
			[t('Onion')]: [result('movie', `${t('Onion')}: A Mystery`, 2022, 7000)],
			[t('Lupin')]: [result('movie', `${t('Lupin')}'s Daughter`, 2021, 8)]
		};
		const shows: Record<string, unknown[]> = {
			[t('Lupin')]: [result('tv', t('Lupin'), 2021, 2000)]
		};
		const calls: unknown[] = [];
		const client = (type: string, list: Record<string, unknown[]>) => ({
			name: 'tmdb',
			client: {
				types: [type],
				search: async (q: string, _type: string, opts: unknown) => {
					calls.push(opts);
					return list[Object.keys(list).find((k) => k.toLowerCase() === q) ?? ''] ?? [];
				},
				get: async (id: string): Promise<ProviderMedia> => ({
					media: { type: type as 'movie', title: id, status: 'finished', totalUnits: 3 },
					externalIds: [{ provider: 'tmdb', externalId: id }],
					titles: []
				})
			}
		});
		const providers = {
			movie: client('movie', movies),
			tv: client('tv', shows)
		} as unknown as Providers;
		const entry = parseLetterboxd({ 'watched.csv': files['watched.csv'] })[0].entry;
		const row = (name: string, year: number) => ({
			label: name,
			type: 'movie' as const,
			search: { title: t(name), year },
			entry
		});
		const stats = await runImport(db, providers, {
			importId: 0,
			userId,
			source: 'letterboxd',
			items: [row('Box', 2021), row('Onion', 2022), row('Lupin', 2021), row('Nothing', 2000)]
		});
		expect(stats).toMatchObject({ imported: 3, unmatched: 1 });
		expect(calls[0]).toEqual({ year: 2021, english: true });
		const rows = await db
			.select({ title: media.title, type: media.type, progress: libraryEntries.progress })
			.from(libraryEntries)
			.innerJoin(media, eq(media.id, libraryEntries.mediaId))
			.where(eq(libraryEntries.userId, userId));
		expect(rows.map((r) => `${r.type}:${r.title.replace(`test-${run}-`, '')}`).sort()).toEqual([
			'movie:movie-Box-2020-1500',
			'movie:movie-Onion-2022-7000',
			'tv:tv-Lupin-2021-2000'
		]);
		expect(rows.find((r) => r.type === 'tv')?.progress).toBe(3); // completed show: every episode
	});
});
