import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/app.ts';
import { users } from '#lib/server/db/schema.ts';
import { removeAvatar, saveAvatar, setDisplayName } from '#lib/server/profile.ts';
import { RATING_SCALES } from '#lib/labels.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const [u] = await db
		.select({
			profileVisibility: users.profileVisibility,
			ratingScale: users.ratingScale,
			displayName: users.displayName,
			avatarUrl: users.avatarUrl
		})
		.from(users)
		.where(eq(users.id, locals.user!.id));
	// Set by the theme choice below; hooks.server.ts applies it to every page
	const cookie = cookies.get('theme');
	const theme: 'light' | 'dark' | 'system' =
		(['light', 'dark'] as const).find((t) => t === cookie) ?? 'system';
	return { ...u, theme };
};

export const actions: Actions = {
	profile: async ({ request, locals }) => {
		const form = await request.formData();
		await setDisplayName(db, locals.user!.id, String(form.get('displayName') ?? ''));
		const file = form.get('avatar');
		if (file instanceof File && file.size > 0) {
			const result = await saveAvatar(
				db,
				locals.user!.id,
				new Uint8Array(await file.arrayBuffer())
			);
			if (result === 'invalid')
				return fail(400, { profileError: 'Choisis une image PNG, JPEG ou WebP.' });
			if (result === 'too_large')
				return fail(400, { profileError: 'Cette image est trop lourde.' });
		}
		return { profileSaved: true };
	},
	removeAvatar: async ({ locals }) => {
		await removeAvatar(db, locals.user!.id);
		return { profileSaved: true };
	},
	preferences: async ({ request, locals }) => {
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
