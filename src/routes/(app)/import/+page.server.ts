import { fail } from '@sveltejs/kit';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, getBoss } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/guard.ts';
import { importJobs } from '#lib/server/db/schema.ts';
import { TRAKT_CLIENT_ID } from '$app/env/private';
import { parseGoodreads } from '#lib/server/imports/goodreads.ts';
import { parseLetterboxd, readLetterboxdFiles } from '#lib/server/imports/letterboxd.ts';
import { parseMal, readMalFile, type MalItem } from '#lib/server/imports/mal.ts';
import type { ImportItem, ImportSource, Unmatched } from '#lib/server/imports/types.ts';
import { QUEUES, type LibraryImportJob } from '#lib/server/jobs.ts';
import type { Actions, PageServerLoad } from './$types';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 10_000;

export const load: PageServerLoad = async ({ locals, url }) => {
	const jobs = await db
		.select()
		.from(importJobs)
		.where(eq(importJobs.userId, requireUser(locals, url).id))
		.orderBy(desc(importJobs.createdAt))
		.limit(10);
	return {
		traktEnabled: !!TRAKT_CLIENT_ID,
		jobs: jobs.map((j) => ({
			id: j.id,
			source: j.source,
			status: j.status,
			error: j.error,
			createdAt: j.createdAt.toISOString(),
			stats: j.stats as { total?: number; imported?: number; kept?: number; unmatched?: number },
			unmatched: j.unmatched as Unmatched[]
		}))
	};
};

/** Records the import and hands it to the worker; one running import per user at a time. */
async function start(
	userId: string,
	source: ImportSource,
	payload: { userName: string } | { items: ImportItem[] | MalItem[] }
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

export const actions: Actions = {
	anilist: async ({ request, locals, url }) => {
		const userName = String((await request.formData()).get('userName') ?? '').trim();
		if (!/^[A-Za-z0-9_-]{2,30}$/.test(userName)) {
			return fail(400, { error: 'Pseudo AniList invalide.' });
		}
		return start(requireUser(locals, url).id, 'anilist', { userName });
	},

	goodreads: async ({ request, locals, url }) => {
		const file = (await request.formData()).get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: 'Choisis le fichier CSV exporté depuis Goodreads.' });
		}
		if (file.size > MAX_FILE_BYTES)
			return fail(400, { error: 'Fichier trop volumineux (5 Mo max).' });
		let items;
		try {
			items = parseGoodreads(await file.text());
		} catch (err) {
			return fail(400, { error: (err as Error).message });
		}
		if (!items.length) return fail(400, { error: 'Aucun livre trouvé dans ce fichier.' });
		if (items.length > MAX_ROWS) return fail(400, { error: `Trop de lignes (${MAX_ROWS} max).` });
		return start(requireUser(locals, url).id, 'goodreads', { items });
	},

	letterboxd: async ({ request, locals, url }) => {
		const files = (await request.formData())
			.getAll('file')
			.filter((f): f is File => f instanceof File && f.size > 0);
		if (!files.length) return fail(400, { error: 'Choisis l’export Letterboxd (fichier ZIP).' });
		if (files.reduce((size, f) => size + f.size, 0) > MAX_FILE_BYTES)
			return fail(400, { error: 'Fichier trop volumineux (5 Mo max).' });
		let items;
		try {
			items = parseLetterboxd(await readLetterboxdFiles(files));
		} catch (err) {
			return fail(400, { error: (err as Error).message });
		}
		if (!items.length) return fail(400, { error: 'Aucun film trouvé dans ce fichier.' });
		if (items.length > MAX_ROWS) return fail(400, { error: `Trop de lignes (${MAX_ROWS} max).` });
		return start(requireUser(locals, url).id, 'letterboxd', { items });
	},

	mal: async ({ request, locals, url }) => {
		const file = (await request.formData()).get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: 'Choisis le fichier exporté depuis MyAnimeList.' });
		}
		if (file.size > MAX_FILE_BYTES)
			return fail(400, { error: 'Fichier trop volumineux (5 Mo max).' });
		let items;
		try {
			items = parseMal(await readMalFile(file));
		} catch (err) {
			return fail(400, { error: (err as Error).message });
		}
		if (!items.length) return fail(400, { error: 'Aucune œuvre trouvée dans ce fichier.' });
		if (items.length > MAX_ROWS) return fail(400, { error: `Trop de lignes (${MAX_ROWS} max).` });
		return start(requireUser(locals, url).id, 'mal', { items });
	},

	trakt: async ({ request, locals, url }) => {
		if (!TRAKT_CLIENT_ID) return fail(503, { error: 'L’import Trakt n’est pas configuré.' });
		const userName = String((await request.formData()).get('userName') ?? '').trim();
		// Trakt slugs: letters, digits, dashes, underscores and dots
		if (!/^[A-Za-z0-9._-]{1,50}$/.test(userName)) {
			return fail(400, { error: 'Pseudo Trakt invalide.' });
		}
		return start(requireUser(locals, url).id, 'trakt', { userName });
	}
};
