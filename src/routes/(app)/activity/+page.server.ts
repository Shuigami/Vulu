import { db } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/guard.ts';
import { feed, feedView } from '#lib/server/social.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const raw = url.searchParams.get('before');
	const before = raw ? new Date(raw) : undefined;
	const { items, next } = await feed(db, {
		viewerId: requireUser(locals, url).id,
		before: before && !Number.isNaN(before.getTime()) ? before : undefined
	});
	return { items: feedView(items), next: next?.toISOString() ?? null };
};
