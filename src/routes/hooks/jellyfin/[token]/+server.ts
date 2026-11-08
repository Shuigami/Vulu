// Jellyfin webhook: POST /hooks/jellyfin/<token>. The secret token in the URL identifies the user
// (no session). Answers fast and leaves matching and library updates to the worker.
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, getBoss } from '#lib/server/app.ts';
import { integrations } from '#lib/server/db/schema.ts';
import { parseJellyfinPayload } from '#lib/server/jellyfin.ts';
import { QUEUES, type JellyfinJob } from '#lib/server/jobs.ts';
import { eventLabel, recordEvent } from '#lib/server/scrobble.ts';
import type { RequestHandler } from './$types';

const MAX_BODY = 64 * 1024;
const empty = (status: number) => new Response(null, { status });

export const POST: RequestHandler = async ({ params, request }) => {
	if (!/^[\w-]{20,64}$/.test(params.token)) error(404, 'Unknown webhook');
	const [integration] = await db
		.select({
			id: integrations.id,
			userId: integrations.userId,
			enabled: integrations.enabled,
			settings: integrations.settings
		})
		.from(integrations)
		.where(and(eq(integrations.webhookToken, params.token), eq(integrations.kind, 'jellyfin')));
	if (!integration?.enabled) error(404, 'Unknown webhook');

	if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) error(413, 'Too large');
	const text = await request.text();
	if (text.length > MAX_BODY) error(413, 'Too large');
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		error(400, 'Body must be JSON (see the template on the Vulu integrations page)');
	}

	const event = parseJellyfinPayload(body);
	if (!event) return empty(204); // not a movie or an episode
	const onlyUser = (integration.settings as { jellyfinUser?: string }).jellyfinUser;
	if (onlyUser && event.user.toLowerCase() !== onlyUser.toLowerCase()) return empty(204);

	if (!event.watched) {
		await recordEvent(db, integration.id, {
			at: new Date().toISOString(),
			label: eventLabel(event),
			result: 'ignored'
		});
		return empty(204);
	}
	const job: JellyfinJob = { integrationId: integration.id, userId: integration.userId, event };
	await (await getBoss()).send(QUEUES.jellyfin, job, { retryLimit: 3 });
	return empty(202);
};
