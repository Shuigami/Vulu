import { error, isActionFailure, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { requireUser } from '#lib/server/guard.ts';
import { start, TRAKT_STATE_COOKIE, traktRedirectUri } from '../start';
import type { RequestHandler } from './$types';

/** Trakt sends the user back here after sign-in, with a one-time code (or error=access_denied). */
export const GET: RequestHandler = async ({ locals, url, cookies }) => {
	const user = requireUser(locals, url);
	const [state, codeVerifier] = cookies.get(TRAKT_STATE_COOKIE)?.split('.') ?? [];
	cookies.delete(TRAKT_STATE_COOKIE, { path: resolve('import/trakt') });
	// The state ties the answer to the sign-in this browser started (no forged imports)
	if (!state || !codeVerifier || url.searchParams.get('state') !== state)
		error(400, 'Lien de connexion Trakt invalide.');

	const code = url.searchParams.get('code');
	let outcome = 'denied';
	if (code) {
		const result = await start(user.id, 'trakt', {
			code,
			redirectUri: traktRedirectUri(url),
			codeVerifier
		});
		outcome = isActionFailure(result)
			? result.status === 409
				? 'busy'
				: 'unavailable'
			: 'started';
	}
	redirect(303, `${resolve('import')}?trakt=${outcome}`);
};
