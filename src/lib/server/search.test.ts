import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from './db';
import { media, mediaTitles } from './db/schema';
import { searchMedia } from './search';

// Integration test: needs a migrated database (pnpm db:up && pnpm db:migrate).
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const db = createDb(url);

afterAll(() => db.$client.end());

class Rollback extends Error {}

/** Runs `fn` in a transaction that is always rolled back, leaving the database untouched. */
async function inRollback(
	fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>
) {
	await db
		.transaction(async (tx) => {
			await fn(tx);
			throw new Rollback();
		})
		.catch((err) => {
			if (!(err instanceof Rollback)) throw err;
		});
}

describe('searchMedia', () => {
	it('finds titles regardless of accents and case', async () => {
		await inRollback(async (tx) => {
			const [frieren] = await tx
				.insert(media)
				.values({ type: 'anime', title: 'Frieren' })
				.returning({ id: media.id });
			await tx.insert(mediaTitles).values([
				{ mediaId: frieren.id, title: 'Sōsō no Furīren', locale: 'ja-Latn' },
				{ mediaId: frieren.id, title: 'Frieren', locale: 'fr' }
			]);
			const [dune] = await tx
				.insert(media)
				.values({ type: 'book', title: 'Dune' })
				.returning({ id: media.id });
			await tx.insert(mediaTitles).values({ mediaId: dune.id, title: 'Dune', locale: 'en' });

			const results = await searchMedia(tx, 'soso no furiren');
			// The database may already hold seed data, so only check the rows inserted here.
			const ids = results.map((r) => r.id);
			expect(ids).toContain(frieren.id);
			expect(ids).not.toContain(dune.id);
			expect(results.find((r) => r.id === frieren.id)?.score).toBe(1);
		});
	});
});
