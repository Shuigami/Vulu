import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

// Every page in (app) requires a signed-in user.
export const load: LayoutServerLoad = ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
	return { user: { username: locals.user.username, displayName: locals.user.name } };
};
