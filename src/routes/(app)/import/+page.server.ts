import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fail, redirect } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { resolve } from '$app/paths';
import { db } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/guard.ts';
import { importJobs } from '#lib/server/db/schema.ts';
import { TRAKT_CLIENT_ID } from '$app/env/private';
import { parseGoodreads } from '#lib/server/imports/goodreads.ts';
import { parseLetterboxd, readLetterboxdFiles } from '#lib/server/imports/letterboxd.ts';
import { parseMal, readMalFile } from '#lib/server/imports/mal.ts';
import type { Unmatched } from '#lib/server/imports/types.ts';
import { start, TRAKT_STATE_COOKIE, traktRedirectUri } from './start';
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
		// Outcome of the Trakt sign-in, set by the import/trakt callback
		traktResult: url.searchParams.get('trakt'),
		jobs: jobs.map((j) => ({
			id: j.id,
			source: j.source,
			status: j.status,
			error: j.error,
			createdAt: j.createdAt.toISOString(),
			stats: j.stats as {
				total?: number;
				imported?: number;
				kept?: number;
				unmatched?: number;
				anime?: { done: number; total: number }; // Trakt: matching anime on AniList first
			},
			unmatched: j.unmatched as Unmatched[]
		}))
	};
};

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
	},

	/** Private profiles: sign in on Trakt, which sends the user back to import/trakt with a code. */
	traktConnect: async ({ locals, url, cookies }) => {
		requireUser(locals, url);
		if (!TRAKT_CLIENT_ID) return fail(503, { error: 'L’import Trakt n’est pas configuré.' });
		const state = randomUUID();
		// PKCE: Trakt gets the hash now, the worker proves it with the verifier when trading the code
		const verifier = randomBytes(32).toString('base64url');
		cookies.set(TRAKT_STATE_COOKIE, `${state}.${verifier}`, {
			path: resolve('import/trakt'),
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 600
		});
		const params = new URLSearchParams({
			response_type: 'code',
			client_id: TRAKT_CLIENT_ID,
			redirect_uri: traktRedirectUri(url),
			state,
			code_challenge: createHash('sha256').update(verifier).digest('base64url'),
			code_challenge_method: 'S256'
		});
		redirect(303, `https://trakt.tv/oauth/authorize?${params}`, { external: ['https://trakt.tv'] });
	}
};
