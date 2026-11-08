import { redirect } from '@sveltejs/kit';
import { socialProviders } from '#lib/server/app.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/');
	return { socialProviders };
};
