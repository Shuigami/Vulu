// Starts a library import; shared by the import page's actions and the Trakt sign-in callback.
import { fail } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { resolve } from '$app/paths';
import { db, getBoss } from '#lib/server/app.ts';
import { importJobs } from '#lib/server/db/schema.ts';
import type { MalItem } from '#lib/server/imports/mal.ts';
import type { ImportItem, ImportSource } from '#lib/server/imports/types.ts';
import { QUEUES, type LibraryImportJob } from '#lib/server/jobs.ts';

export const TRAKT_STATE_COOKIE = 'trakt_oauth_state';
/** Must match the redirect URI registered in the Trakt application. */
export const traktRedirectUri = (url: URL) => new URL(resolve('import/trakt'), url.origin).href;

/** Records the import and hands it to the worker; one running import per user at a time. */
export async function start(
	userId: string,
	source: ImportSource,
	payload:
		| { userName: string }
		| { code: string; redirectUri: string }
		| { items: ImportItem[] | MalItem[] }
) {
	const running = await db
		.select({ id: importJobs.id })
		.from(importJobs)
		.where(and(eq(importJobs.userId, userId), inArray(importJobs.status, ['pending', 'running'])));
	if (running.length)
		return fail(409, { error: 'Un import est déjà en cours, attends qu’il se termine.' });

	let boss;
	try {
		boss = await getBoss();
	} catch {
		return fail(503, { error: 'Le service d’import est indisponible, réessaie plus tard.' });
	}
	const [job] = await db
		.insert(importJobs)
		.values({ userId, source })
		.returning({ id: importJobs.id });
	const data = { importId: job.id, userId, source, ...payload } as LibraryImportJob;
	// Large libraries take a while (Open Library is limited to one request per second)
	await boss.send(QUEUES.libraryImport, data, { retryLimit: 0, expireInSeconds: 3 * 3600 });
	return { started: true };
}
