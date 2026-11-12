// Access rules for pages and actions (app only). Browsing is open; personal pages and every
// change need an account.
import { redirect } from '@sveltejs/kit';

/** Stands for a signed-out visitor in visibility checks: owns nothing, follows no one. */
export const ANONYMOUS_ID = '00000000-0000-0000-0000-000000000000';

export const viewerId = (locals: App.Locals) => locals.user?.id ?? ANONYMOUS_ID;

/** The signed-in user, or a redirect to the login page that comes back here afterwards. */
export function requireUser(locals: App.Locals, url: URL) {
	if (locals.user) return locals.user;
	// A form action URL ends in ?/name: come back to the page itself
	const back = url.search.startsWith('?/') ? url.pathname : url.pathname + url.search;
	redirect(303, `/login?redirectTo=${encodeURIComponent(back)}`);
}
