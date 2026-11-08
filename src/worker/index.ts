// Worker entry point: runs pg-boss jobs with the same code as the SvelteKit app.
// Only the worker calls the TMDB, AniList and Open Library APIs.
import { PgBoss } from 'pg-boss';
import { createProviders, importMedia, searchProvider } from '../lib/server/catalogue';
import { createDb } from '../lib/server/db';
import {
	QUEUES,
	type ImportJob,
	type ImportOutput,
	type SearchJob,
	type SearchOutput
} from '../lib/server/jobs';
import { purgeExpired } from '../lib/server/providers/cache';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
if (!process.env.TMDB_API_KEY)
	console.warn('[worker] TMDB_API_KEY is not set: movie/TV jobs will fail');

const db = createDb(url);
const providers = createProviders(process.env);
const boss = new PgBoss(url);
boss.on('error', (err) => console.error('[worker] pg-boss error', err));

await boss.start();
for (const name of Object.values(QUEUES)) await boss.createQueue(name);

await boss.work<SearchJob, SearchOutput>(QUEUES.search, async ([job]) => ({
	results: await searchProvider(db, providers, job.data.type, job.data.query)
}));

await boss.work<ImportJob, ImportOutput>(QUEUES.importMedia, async ([job]) => {
	const { type, externalId } = job.data;
	const mediaId = await importMedia(db, providers, type, externalId);
	console.log(`[worker] import ${type} ${externalId} -> media ${mediaId}`);
	return { mediaId };
});

await boss.work(QUEUES.purgeCache, async () => {
	console.log(`[worker] purged ${await purgeExpired(db)} expired cache entries`);
});
await boss.schedule(QUEUES.purgeCache, '0 4 * * *'); // daily, 04:00 UTC

console.log('[worker] started');

async function shutdown(signal: string) {
	console.log(`[worker] ${signal} received, stopping`);
	await boss.stop({ graceful: true });
	await db.$client.end();
	process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
