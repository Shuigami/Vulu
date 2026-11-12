import { error } from '@sveltejs/kit';
import { db } from '#lib/server/app.ts';
import { viewerId } from '#lib/server/guard.ts';
import { followList, profileByUsername } from '#lib/server/social.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const which = params.which;
	if (which !== 'followers' && which !== 'following') error(404, 'Page introuvable');
	const profile = await profileByUsername(db, params.username, viewerId(locals));
	if (!profile) error(404, 'Profil introuvable');
	return { which, user: profile.user, users: await followList(db, profile.user.id, which) };
};
