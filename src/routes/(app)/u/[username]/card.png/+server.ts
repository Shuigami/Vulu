import { error } from '@sveltejs/kit';
import { db } from '#lib/server/app.ts';
import { profileCard } from '#lib/server/cards/cards.ts';
import { loadImage, OG, pngResponse, renderPng } from '#lib/server/cards/render.ts';
import { ANONYMOUS_ID } from '#lib/server/guard.ts';
import { profileByUsername } from '#lib/server/social.ts';
import type { RequestHandler } from './$types';

// Always the signed-out view: the image is shared and cached
export const GET: RequestHandler = async ({ params, url }) => {
	const p = await profileByUsername(db, params.username, ANONYMOUS_ID);
	if (!p) error(404);
	const favorites = p.favorites.slice(0, 3);
	const [avatar, ...posters] = await Promise.all([
		loadImage(p.user.avatarUrl, url.origin),
		...favorites.map((f) => loadImage(f.posterUrl, url.origin))
	]);
	const name = p.user.displayName || p.user.username;
	const card = profileCard({
		host: url.host,
		name,
		username: p.user.username,
		avatar,
		followers: p.followers,
		completed: p.completed,
		favorites: favorites.map((f, i) => ({ title: f.title, poster: posters[i] }))
	});
	return pngResponse(await renderPng(card, OG));
};
