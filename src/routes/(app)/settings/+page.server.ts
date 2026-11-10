import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/app.ts';
import { users } from '#lib/server/db/schema.ts';
import { RATING_SCALES } from '#lib/labels.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const [u] = await db
		.select({ profileVisibility: users.profileVisibility, ratingScale: users.ratingScale })
		.from(users)
		.where(eq(users.id, locals.user!.id));
	return u;
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const form = await request.formData();
		const visibility = form.get('profileVisibility');
		const ratingScale = Number(form.get('ratingScale'));
		if (visibility !== 'public' && visibility !== 'private')
			return fail(400, { error: 'Visibilité invalide.' });
		if (!RATING_SCALES.includes(ratingScale as (typeof RATING_SCALES)[number]))
			return fail(400, { error: 'Échelle de notation invalide.' });
		await db
			.update(users)
			.set({ profileVisibility: visibility, ratingScale })
			.where(eq(users.id, locals.user!.id));
		return { saved: true };
	}
};
