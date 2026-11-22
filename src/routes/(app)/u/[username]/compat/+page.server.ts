import { error } from '@sveltejs/kit';
import { db } from '#lib/server/app.ts';
import { compatibility, compatVerdict } from '#lib/server/compat.ts';
import { viewerId as viewerOf } from '#lib/server/guard.ts';
import { findUser } from '#lib/server/social.ts';
import type { PageServerLoad } from './$types';

/** `username` compared with `?avec=<other>`, or with the signed-in viewer. */
export const load: PageServerLoad = async ({ params, locals, url }) => {
	const viewerId = viewerOf(locals);
	const other = await findUser(db, params.username, viewerId);
	if (!other) error(404, 'Profil introuvable');
	const avec = url.searchParams.get('avec');
	const me = avec
		? await findUser(db, avec, viewerId)
		: locals.user && (await findUser(db, locals.user.username!, viewerId));
	if (avec && !me) error(404, 'Profil introuvable');
	const view = (u: NonNullable<typeof me>) => ({
		username: u.username,
		name: u.displayName || u.username,
		avatarUrl: u.avatarUrl
	});
	const result =
		me && me.id !== other.id ? await compatibility(db, me.id, other.id, viewerId) : null;
	return {
		other: view(other),
		me: me ? view(me) : null,
		isViewer: !!me && me.id === locals.user?.id,
		result,
		verdict: result?.percent != null ? compatVerdict(result.percent) : null
	};
};
