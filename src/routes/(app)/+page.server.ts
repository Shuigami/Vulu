import { error } from '@sveltejs/kit';
import { db } from '#lib/server/app.ts';
import { incrementProgress, listEntries } from '#lib/server/library.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => ({
	entries: await listEntries(db, locals.user!.id, { status: 'in_progress' })
});

export const actions: Actions = {
	increment: async ({ request, locals }) => {
		const entryId = Number((await request.formData()).get('entryId'));
		if (!(await incrementProgress(db, locals.user!.id, entryId))) error(404, 'Entrée introuvable');
	}
};
