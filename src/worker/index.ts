// Worker entry point: runs pg-boss jobs with the same code as the SvelteKit app.
// Only the worker calls the TMDB, AniList and Open Library APIs.
import { PgBoss } from 'pg-boss';
import {
	airingWithoutEpisodes,
	createProviders,
	discoverProvider,
	hasEpisodes,
	importMedia,
	searchProvider,
	staleAiringMedia,
	syncEpisodes
} from '../lib/server/catalogue';
import { createDb } from '../lib/server/db';
import {
	QUEUES,
	type DiscoverJob,
	type EpisodesJob,
	type FranchiseJob,
	type JellyfinJob,
	type LibraryImportJob,
	type ImportJob,
	type ImportOutput,
	type SearchJob,
	type SearchOutput
} from '../lib/server/jobs';
import { and, eq } from 'drizzle-orm';
import { importJobs, mediaExternalIds } from '../lib/server/db/schema';
import { animeToGroup, mergeSeasons } from '../lib/server/franchises';
import { resolveMal } from '../lib/server/imports/mal';
import { resolveTraktAnime } from '../lib/server/imports/trakt';
import { runImport } from '../lib/server/imports/run';
import type { ImportItem } from '../lib/server/imports/types';
import { purgeExpired } from '../lib/server/providers/cache';
import { createTraktClient } from '../lib/server/providers/trakt';
import { eventLabel, recordEvent, scrobble } from '../lib/server/scrobble';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
if (!process.env.TMDB_API_KEY)
	console.warn('[worker] TMDB_API_KEY is not set: movie/TV jobs will fail');

const db = createDb(url);
const providers = createProviders(process.env);
const trakt = process.env.TRAKT_CLIENT_ID
	? createTraktClient({ clientId: process.env.TRAKT_CLIENT_ID })
	: null;
// LISTEN/NOTIFY (one connection) wakes workers as soon as the app sends a job the user waits on
const boss = new PgBoss({ connectionString: url, useListenNotify: true });
boss.on('error', (err) => console.error('[worker] pg-boss error', err));

await boss.start();
for (const name of Object.values(QUEUES)) await boss.createQueue(name);
// Without notify a job waits up to the 2 s polling interval before a worker picks it up
for (const name of [QUEUES.search, QUEUES.discover, QUEUES.importMedia])
	await boss.updateQueue(name, { notify: true });

// A search on "all types" sends one job per type: run them side by side, the per-provider
// rate limiters still keep each API within its quota.
await boss.work<SearchJob, SearchOutput>(QUEUES.search, { localConcurrency: 5 }, async ([job]) => ({
	results: await searchProvider(db, providers, job.data.type, job.data.query)
}));

await boss.work<DiscoverJob, SearchOutput>(
	QUEUES.discover,
	{ localConcurrency: 5 },
	async ([job]) => ({
		results: await discoverProvider(db, providers, job.data.type, job.data.externalId)
	})
);

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
	// Works of the franchise's seasons imported before it (or by a list import) join it now
	const merged = await mergeSeasons(db, job.data.mediaId);
	if (merged) console.log(`[worker] franchise ${job.data.mediaId} merged ${merged} works`);
});

// Anime stored as one work per AniList season (before franchises, docs/franchises-anime.md):
// re-imported as their franchise, episodes synced, then the season works merged into it.
// One at a time: each costs a request per season against AniList's 30 a minute.
await boss.work<FranchiseJob>(QUEUES.animeFranchises, async ([job]) => {
	const { mediaId } = job.data;
	if (!mediaId) {
		const ids = await animeToGroup(db);
		for (const id of ids)
			await boss.send(QUEUES.animeFranchises, { mediaId: id }, { singletonKey: `franchise:${id}` });
		return void console.log(`[worker] franchises queued for ${ids.length} anime`);
	}
	const [primary] = await db
		.select({ externalId: mediaExternalIds.externalId })
		.from(mediaExternalIds)
		.where(and(eq(mediaExternalIds.mediaId, mediaId), eq(mediaExternalIds.isPrimary, true)));
	if (!primary) return; // already merged into its franchise by an earlier job
	const franchiseId = await importMedia(db, providers, 'anime', primary.externalId, {
		refresh: true
	});
	if (!franchiseId) return;
	await syncEpisodes(db, providers, franchiseId);
	const merged = await mergeSeasons(db, franchiseId);
	console.log(`[worker] franchise of media ${mediaId} -> ${franchiseId}, merged ${merged}`);
});
// shortcut: queued at every start; once done only anime that cannot form a franchise (side
// branches, works AniList dropped) are tried again. Stop it if those become many.
await boss.send(QUEUES.animeFranchises, {}, { singletonKey: 'franchises:all' });

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

// Library imports: AniList lists are fetched here (the app never calls providers).
await boss.work<LibraryImportJob>(QUEUES.libraryImport, async ([job]) => {
	const { importId, userId } = job.data;
	const fail = (error: string) =>
		db
			.update(importJobs)
			.set({ status: 'failed', error, finishedAt: new Date() })
			.where(eq(importJobs.id, importId));
	// Fetching and matching can take minutes before runImport starts: running already
	await db.update(importJobs).set({ status: 'running' }).where(eq(importJobs.id, importId));

	let items: ImportItem[];
	if (job.data.source === 'anilist') {
		const { userName } = job.data;
		const lists = await Promise.all([
			providers.anilist!.userList(userName, 'anime'),
			providers.anilist!.userList(userName, 'manga')
		]);
		if (lists.every((l) => l === null)) return void (await fail('anilist_user_not_found'));
		items = lists.flatMap((l) => l ?? []);
	} else if (job.data.source === 'trakt') {
		if (!trakt) return void (await fail('trakt_not_configured'));
		let library;
		if ('code' in job.data) {
			const { code, redirectUri, codeVerifier } = job.data;
			const token = await trakt.exchangeCode(code, redirectUri, codeVerifier);
			if (!token) return void (await fail('trakt_auth_failed'));
			try {
				library = await trakt.userLibrary('me', token);
			} finally {
				await trakt.revoke(token).catch((err) => console.error('[worker] trakt revoke', err));
			}
		} else library = await trakt.userLibrary(job.data.userName);
		if (!library) return void (await fail('trakt_user_not_found'));
		items = await resolveTraktAnime(db, providers.anilist!, library, (done, total) =>
			db
				.update(importJobs)
				.set({ stats: { anime: { done, total } } })
				.where(eq(importJobs.id, importId))
		);
	} else if (job.data.source === 'mal') {
		items = await resolveMal(providers.anilist!, job.data.items);
	} else {
		items = job.data.items;
	}
	const stats = await runImport(db, providers, {
		importId,
		userId,
		source: job.data.source,
		items
	});
	console.log(`[worker] library import ${importId} (${job.data.source})`, stats);
	// Imported airing shows need their episodes now, not at the next daily refresh
	for (const mediaId of await airingWithoutEpisodes(db, userId)) {
		await boss.send(QUEUES.syncEpisodes, { mediaId });
	}
});

// Jellyfin "watched" events, queued by /hooks/jellyfin/[token]
await boss.work<JellyfinJob>(QUEUES.jellyfin, async ([job]) => {
	const { integrationId, userId, event } = job.data;
	const result = await scrobble(db, providers, userId, event);
	await recordEvent(db, integrationId, {
		at: new Date().toISOString(),
		label: eventLabel(event),
		result
	});
	console.log(`[worker] jellyfin ${eventLabel(event)} -> ${result}`);
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
