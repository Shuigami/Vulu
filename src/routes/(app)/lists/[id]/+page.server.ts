import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/app.ts';
import {
	deleteList,
	getList,
	parseListInput,
	removeFromList,
	updateList
} from '#lib/server/lists.ts';
import type { Actions, PageServerLoad } from './$types';

const parseId = (raw: string) => {
	const id = Number(raw);
	if (!Number.isInteger(id) || id <= 0) error(404, 'Liste introuvable');
	return id;
};

export const load: PageServerLoad = async ({ params, locals }) => {
	const list = await getList(db, parseId(params.id), locals.user!.id);
	if (!list) error(404, 'Liste introuvable');
	return { list };
};

export const actions: Actions = {
	update: async ({ params, request, locals }) => {
		const input = parseListInput(await request.formData());
		if (typeof input === 'string') return fail(400, { error: input });
		if (!(await updateList(db, locals.user!.id, parseId(params.id), input))) error(404);
		return { saved: true };
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
