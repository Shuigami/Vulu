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
			completedOn: null,
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

	it('picks the search result of the same year, else one year off', async () => {
		[{ id: userId }] = await db
			.insert(users)
			.values({ email: `lbx-${run}@test.vulu`, username: `lbx_${run}` })
			.returning({ id: users.id });
		const result = (id: string, year: number) => ({
			provider: 'tmdb',
			externalId: `test-${run}-${id}`,
			type: 'movie',
			title: `Film ${run}`,
			year
		});
		const providers = {
			movie: {
				name: 'tmdb',
				client: {
					types: ['movie'],
					search: async (q: string) =>
						q.includes('remake')
							? [result('1990', 1990)]
							: [result('1984', 1984), result('2021', 2021)],
					get: async (id: string): Promise<ProviderMedia> => ({
						media: {
							type: 'movie',
							title: `Film ${run} ${id.split('-').pop()}`,
							status: 'finished'
						},
						externalIds: [{ provider: 'tmdb', externalId: id }],
						titles: []
					})
				}
			}
		} as unknown as Providers;
		const entry = parseLetterboxd({ 'watched.csv': files['watched.csv'] })[0].entry;
		const stats = await runImport(db, providers, {
			importId: 0,
			userId,
			source: 'letterboxd',
			items: [
				{ label: 'Same year', type: 'movie', search: { title: `Film ${run}`, year: 2021 }, entry },
				{
					label: 'Off by one',
					type: 'movie',
					search: { title: `Film ${run} remake`, year: 1991 },
					entry
				},
				{ label: 'No match', type: 'movie', search: { title: `Film ${run}`, year: 2000 }, entry }
			]
		});
		expect(stats).toMatchObject({ imported: 2, unmatched: 1 });
		const titles = await db
			.select({ title: media.title })
			.from(libraryEntries)
			.innerJoin(media, eq(media.id, libraryEntries.mediaId))
			.where(eq(libraryEntries.userId, userId));
		expect(titles.map((t) => t.title).sort()).toEqual([`Film ${run} 1990`, `Film ${run} 2021`]);
	});
});
