import { fail, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/guard.ts';
import { createList, listsOf, parseListInput } from '#lib/server/lists.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => ({
	lists: await listsOf(db, requireUser(locals, url).id, locals.user!.id)
});

export const actions: Actions = {
	create: async ({ request, locals, url }) => {
		const input = parseListInput(await request.formData());
		if (typeof input === 'string') return fail(400, { error: input });
		const id = await createList(db, requireUser(locals, url).id, input);
		redirect(303, `/lists/${id}`);
	}
};
