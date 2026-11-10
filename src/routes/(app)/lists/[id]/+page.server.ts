import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/app.ts';
import { media } from '#lib/server/db/schema.ts';
import {
	addToList,
	deleteList,
	getList,
	parseListInput,
	removeFromList,
	updateList
} from '#lib/server/lists.ts';
import { searchMedia } from '#lib/server/search.ts';
import type { Actions, PageServerLoad } from './$types';

const parseId = (raw: string) => {
	const id = Number(raw);
	if (!Number.isInteger(id) || id <= 0) error(404, 'Liste introuvable');
	return id;
};

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const list = await getList(db, parseId(params.id), locals.user!.id);
	if (!list) error(404, 'Liste introuvable');
	// Owner only: search the catalogue to add works without leaving the list
	const q = (list.isOwner && url.searchParams.get('q')?.trim().slice(0, 100)) || '';
	const results = q ? await searchMedia(db, q, { limit: 12 }) : [];
	return { list, q, results };
};

export const actions: Actions = {
	update: async ({ params, request, locals }) => {
		const input = parseListInput(await request.formData());
		if (typeof input === 'string') return fail(400, { error: input });
		if (!(await updateList(db, locals.user!.id, parseId(params.id), input))) error(404);
		return { saved: true };
	},
	add: async ({ params, request, locals }) => {
		const mediaId = Number((await request.formData()).get('mediaId'));
		if (!Number.isInteger(mediaId) || mediaId <= 0) return fail(400);
		if (!(await db.$count(media, eq(media.id, mediaId)))) return fail(404);
		await addToList(db, locals.user!.id, parseId(params.id), mediaId);
	},
	remove: async ({ params, request, locals }) => {
		const mediaId = Number((await request.formData()).get('mediaId'));
		if (!Number.isInteger(mediaId)) return fail(400);
		await removeFromList(db, locals.user!.id, parseId(params.id), mediaId);
	},
	delete: async ({ params, locals }) => {
		if (!(await deleteList(db, locals.user!.id, parseId(params.id)))) error(404);
		redirect(303, '/lists');
	}
};
