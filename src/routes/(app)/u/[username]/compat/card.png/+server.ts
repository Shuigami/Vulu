import { error } from '@sveltejs/kit';
import { db } from '#lib/server/app.ts';
import { compatCard } from '#lib/server/cards/cards.ts';
import { loadImage, OG, pngResponse, renderPng } from '#lib/server/cards/render.ts';
import { compatibility, compatVerdict } from '#lib/server/compat.ts';
import { ANONYMOUS_ID } from '#lib/server/guard.ts';
import { findUser } from '#lib/server/social.ts';
import type { RequestHandler } from './$types';

/** `?avec=<username>` is required. Always the signed-out view: the image is shared and cached. */
export const GET: RequestHandler = async ({ params, url }) => {
	const [a, b] = await Promise.all([
		findUser(db, url.searchParams.get('avec') ?? '', ANONYMOUS_ID),
		findUser(db, params.username, ANONYMOUS_ID)
	]);
	if (!a || !b || a.id === b.id) error(404);
	const result = await compatibility(db, a.id, b.id, ANONYMOUS_ID);
	const loved = result.loved.slice(0, 4);
	const [avatarA, avatarB, ...posters] = await Promise.all([
		loadImage(a.avatarUrl, url.origin),
		loadImage(b.avatarUrl, url.origin),
		...loved.map((l) => loadImage(l.posterUrl, url.origin))
	]);
	const card = compatCard({
		host: url.host,
		a: { name: a.displayName || a.username, avatar: avatarA },
		b: { name: b.displayName || b.username, avatar: avatarB },
		percent: result.percent,
		verdict: result.percent === null ? null : compatVerdict(result.percent),
		shared: result.shared,
		posters: loved.map((l, i) => ({ title: l.title, poster: posters[i] }))
	});
	return pngResponse(await renderPng(card, OG));
};
