// Worker entry point: runs pg-boss jobs with the same code as the SvelteKit app.
// Only the worker calls the TMDB, AniList and Open Library APIs.
import { PgBoss } from 'pg-boss';
import {
	createProviders,
	hasEpisodes,
	importMedia,
	searchProvider,
	staleAiringMedia,
	syncEpisodes
} from '../lib/server/catalogue';
import { createDb } from '../lib/server/db';
import {
	QUEUES,
	type EpisodesJob,
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

// A search on "all types" sends one job per type: run them side by side, the per-provider
// rate limiters still keep each API within its quota.
await boss.work<SearchJob, SearchOutput>(QUEUES.search, { localConcurrency: 5 }, async ([job]) => ({
	results: await searchProvider(db, providers, job.data.type, job.data.query)
}));

await boss.work<ImportJob, ImportOutput>(
	QUEUES.importMedia,
	{ localConcurrency: 3 },
	async ([job]) => {
		const { type, externalId, refresh } = job.data;
		const mediaId = await importMedia(db, providers, type, externalId, { refresh });
		console.log(`[worker] import ${type} ${externalId} -> media ${mediaId}`);
		// Episodes come in a separate job so adding a show stays fast for the user
		if (mediaId && hasEpisodes(type)) await boss.send(QUEUES.syncEpisodes, { mediaId });
		return { mediaId };
	}
);

await boss.work<EpisodesJob>(QUEUES.syncEpisodes, { localConcurrency: 2 }, async ([job]) => {
	const count = await syncEpisodes(db, providers, job.data.mediaId);
	console.log(`[worker] episodes media ${job.data.mediaId} -> ${count}`);
});

// Daily: re-import airing media that users follow (status, totals), which re-syncs episodes.
await boss.work(QUEUES.refreshAiring, async () => {
	const stale = await staleAiringMedia(db);
	for (const m of stale) {
		const job: ImportJob = {
			type: m.type,
			provider: m.provider,
			externalId: m.externalId,
			refresh: true
		};
		await boss.send(QUEUES.importMedia, job);
	}
	console.log(`[worker] refresh queued for ${stale.length} airing media`);
});
await boss.schedule(QUEUES.refreshAiring, '0 3 * * *'); // daily, 03:00 UTC

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
