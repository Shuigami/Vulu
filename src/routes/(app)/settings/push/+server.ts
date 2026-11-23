// Web push devices of the signed-in user: the settings page posts the browser's subscription
// (POST) or the endpoint it dropped (DELETE).
import { error } from '@sveltejs/kit';
import { db } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/guard.ts';
import { removePushSubscription, savePushSubscription } from '#lib/server/notifications.ts';
import { parseSubscription } from '#lib/server/webpush.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, url }) => {
	const user = requireUser(locals, url);
	const sub = parseSubscription(await request.json().catch(() => null));
	if (!sub) error(400, 'Abonnement invalide.');
	await savePushSubscription(db, user.id, sub);
	return new Response(null, { status: 204 });
};

export const DELETE: RequestHandler = async ({ request, locals, url }) => {
	const user = requireUser(locals, url);
	const { endpoint } = (await request.json().catch(() => ({}))) as { endpoint?: unknown };
	if (typeof endpoint !== 'string') error(400, 'Abonnement invalide.');
	await removePushSubscription(db, user.id, endpoint);
	return new Response(null, { status: 204 });
};
