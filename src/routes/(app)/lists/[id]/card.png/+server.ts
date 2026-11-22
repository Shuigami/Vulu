import { error } from '@sveltejs/kit';
import { db } from '#lib/server/app.ts';
import { listCard } from '#lib/server/cards/cards.ts';
import { loadImage, OG, pngResponse, renderPng } from '#lib/server/cards/render.ts';
import { ANONYMOUS_ID } from '#lib/server/guard.ts';
import { getList } from '#lib/server/lists.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	const id = Number(params.id);
	const list = Number.isInteger(id) && id > 0 ? await getList(db, id, ANONYMOUS_ID) : null;
	if (!list) error(404);
	const shown = list.items.slice(0, 9);
	const posters = await Promise.all(shown.map((i) => loadImage(i.posterUrl, url.origin)));
	const card = listCard({
		host: url.host,
		name: list.name,
		owner: list.username,
		count: list.items.length,
		posters: shown.map((i, n) => ({ title: i.title, poster: posters[n] }))
	});
	return pngResponse(await renderPng(card, OG));
};
