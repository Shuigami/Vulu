import { building } from '$app/env';
import type { Handle } from '@sveltejs/kit/hooks';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '#lib/server/app.ts';

export const handle: Handle = async ({ event, resolve }) => {
	const session = building ? null : await auth.api.getSession({ headers: event.request.headers });
	event.locals.user = session?.user ?? null;
	event.locals.session = session?.session ?? null;
	// Serves /api/auth/* and passes every other request to SvelteKit.
	return svelteKitHandler({ event, resolve, auth, building });
};
