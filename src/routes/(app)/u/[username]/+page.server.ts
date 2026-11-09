import { error } from '@sveltejs/kit';
import { db } from '#lib/server/app.ts';
import { feed, feedView, follow, profileByUsername, unfollow } from '#lib/server/social.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const viewerId = locals.user!.id;
	const profile = await profileByUsername(db, params.username, viewerId);
	if (!profile) error(404, 'Profil introuvable');
	const { items } = await feed(db, { viewerId, userId: profile.user.id, limit: 20 });
	return { profile, activity: feedView(items) };
};

export const actions: Actions = {
	follow: async ({ params, locals }) => {
		await follow(db, locals.user!.id, params.username);
	},
	unfollow: async ({ params, locals }) => {
		await unfollow(db, locals.user!.id, params.username);
	}
};
