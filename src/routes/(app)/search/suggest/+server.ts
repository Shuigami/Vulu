import { error, json } from '@sveltejs/kit';
import { db } from '#lib/server/app.ts';
import { searchMedia } from '#lib/server/search.ts';
import type { RequestHandler } from './$types';

/** Header search suggestions: the local catalogue only (fast, no provider call). */
export const GET: RequestHandler = async ({ url, locals }) => {
	// Endpoints do not go through the (app) layout guard
	if (!locals.user) error(401);
	const q = url.searchParams.get('q')?.trim().slice(0, 200) ?? '';
	if (q.length < 2) return json([]);
	const results = await searchMedia(db, q, { limit: 6 });
	return json(
		results.map(({ id, type, title, posterUrl, year }) => ({ id, type, title, posterUrl, year }))
	);
};
