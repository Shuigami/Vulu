import { fail, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/app.ts';
import { createList, listsOf, parseListInput } from '#lib/server/lists.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => ({
	lists: await listsOf(db, locals.user!.id, locals.user!.id)
});

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const input = parseListInput(await request.formData());
		if (typeof input === 'string') return fail(400, { error: input });
		const id = await createList(db, locals.user!.id, input);
		redirect(303, `/lists/${id}`);
	}
};
