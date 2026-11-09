import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/app.ts';
import { users } from '#lib/server/db/schema.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const [u] = await db
		.select({ profileVisibility: users.profileVisibility })
		.from(users)
		.where(eq(users.id, locals.user!.id));
	return { profileVisibility: u.profileVisibility };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const visibility = (await request.formData()).get('profileVisibility');
		if (visibility !== 'public' && visibility !== 'private')
			return fail(400, { error: 'Visibilité invalide.' });
		await db
			.update(users)
			.set({ profileVisibility: visibility })
			.where(eq(users.id, locals.user!.id));
		return { saved: true };
	}
};
