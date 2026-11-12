import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { db, getBoss } from '#lib/server/app.ts';
import { requireUser, viewerId } from '#lib/server/guard.ts';
import { libraryEntries } from '#lib/server/db/schema.ts';
import { QUEUES, requestJob, type ImportOutput } from '#lib/server/jobs.ts';
import { addToLibrary } from '#lib/server/library.ts';
import { LOCAL_ENOUGH, searchMedia, searchProviders } from '#lib/server/search.ts';
import { searchUsers } from '#lib/server/social.ts';
import { isMediaType } from '#lib/labels.ts';
import type { Actions, PageServerLoad } from './$types';

const PROVIDERS = ['tmdb', 'anilist', 'openlibrary'] as const;

export const load: PageServerLoad = async ({ url, locals }) => {
	const q = url.searchParams.get('q')?.trim().slice(0, 200) ?? '';
	const typeParam = url.searchParams.get('type');
	const type = isMediaType(typeParam) ? typeParam : undefined;
	if (!q) return { q, type, members: [], local: [], inLibrary: [], remote: null };

	const [local, members] = await Promise.all([
		searchMedia(db, q, { type }),
		type ? [] : searchUsers(db, q)
	]);
	const inLibrary = local.length
		? (
				await db
					.select({ mediaId: libraryEntries.mediaId })
					.from(libraryEntries)
					.where(
						and(
							eq(libraryEntries.userId, viewerId(locals)),
							inArray(
								libraryEntries.mediaId,
								local.map((m) => m.id)
							)
						)
					)
			).map((e) => e.mediaId)
		: [];

	// Streamed: local results show at once, provider results when the worker answers.
	const remote =
		local.length >= LOCAL_ENOUGH
			? null
			: getBoss()
					.then((boss) => searchProviders(db, boss, q, type))
					.catch((err) => {
						console.error('[search] provider search unavailable', err);
						return { results: [], failed: true };
					});

	return { q, type, members, local, inLibrary, remote };
};

/** Imports the provider result posted in `form`; returns its catalogue id or a failure. */
async function importResult(form: FormData) {
	const type = form.get('type');
	const provider = form.get('provider');
	const externalId = String(form.get('externalId') ?? '');
	if (
		!isMediaType(type) ||
		!PROVIDERS.includes(provider as (typeof PROVIDERS)[number]) ||
		!/^[\w-]{1,64}$/.test(externalId)
	) {
		error(400, 'Œuvre invalide');
	}

	let mediaId: number | null;
	try {
		const boss = await getBoss();
		({ mediaId } = await requestJob<ImportOutput>(
			boss,
			QUEUES.importMedia,
			{ type, provider, externalId },
			20_000
		));
	} catch {
		return fail(503, { importError: 'L’ajout a échoué, réessaie dans un instant.' });
	}
	return mediaId ?? fail(404, { importError: 'Cette œuvre est introuvable chez le fournisseur.' });
}

export const actions: Actions = {
	/** Adds a media already in the catalogue. */
	add: async ({ request, locals, url }) => {
		const mediaId = Number((await request.formData()).get('mediaId'));
		if (!Number.isInteger(mediaId) || mediaId <= 0) error(400, 'Œuvre invalide');
		await addToLibrary(db, requireUser(locals, url).id, mediaId);
		redirect(303, `/media/${mediaId}`);
	},

	/** Imports a provider result into the catalogue through the worker, then adds it. */
	import: async ({ request, locals, url }) => {
		const mediaId = await importResult(await request.formData());
		if (typeof mediaId !== 'number') return mediaId;
		await addToLibrary(db, requireUser(locals, url).id, mediaId);
		redirect(303, `/media/${mediaId}`);
	},

	/** Same import, without adding: opens the media page (home page suggestions). */
	open: async ({ request }) => {
		const mediaId = await importResult(await request.formData());
		if (typeof mediaId !== 'number') return mediaId;
		redirect(303, `/media/${mediaId}`);
	}
};
