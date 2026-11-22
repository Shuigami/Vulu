import { redirect } from '@sveltejs/kit';
import { requireUser } from '#lib/server/guard.ts';
import type { PageServerLoad } from './$types';

// Short link for the banner and for sharing: one's own recap
export const load: PageServerLoad = ({ locals, url }) => {
	redirect(303, `/u/${requireUser(locals, url).username!}/recap${url.search}`);
};
