import { error } from '@sveltejs/kit';
import { db } from '#lib/server/app.ts';
import { getAvatar } from '#lib/server/profile.ts';
import type { RequestHandler } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Avatars show next to public activity, so any signed-in member may load them.
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401);
	if (!UUID.test(params.id)) error(404);
	const avatar = await getAvatar(db, params.id);
	if (!avatar) error(404);
	return new Response(new Uint8Array(avatar.data), {
		headers: {
			'content-type': avatar.contentType,
			// The URL carries a version (?v=), so a new upload is a new URL
			'cache-control': 'private, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff'
		}
	});
};
