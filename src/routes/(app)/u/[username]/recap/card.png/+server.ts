import { error } from '@sveltejs/kit';
import { dev } from '$app/env';
import { db } from '#lib/server/app.ts';
import { findUser } from '#lib/server/social.ts';
import { recapCard, recapStory, recapTeaser } from '#lib/server/cards/recap.ts';
import { loadImage, OG, pngResponse, renderPng, STORY } from '#lib/server/cards/render.ts';

/** Perfect scores shown: three rows of six on the story, two of three on the preview */
const STORY_STARS = 18;
const OG_STARS = 6;
import { ANONYMOUS_ID } from '#lib/server/guard.ts';
import {
	RECAP_STARS_MIN,
	RECAP_YEAR,
	recapOpen,
	releaseLabel,
	yearRecap
} from '#lib/server/recap.ts';
import type { RequestHandler } from './$types';

/** `?format=story` for 1080x1920. Always the signed-out view: the image is shared and cached. */
export const GET: RequestHandler = async ({ params, url }) => {
	const user = await findUser(db, params.username, ANONYMOUS_ID);
	if (!user) error(404);
	const story = url.searchParams.get('format') === 'story';
	const size = story ? STORY : OG;
	const footer = `${url.host}/u/${user.username}/recap`;
	if (!recapOpen() && !(dev && url.searchParams.has('apercu')))
		return pngResponse(
			await renderPng(
				recapTeaser({ year: RECAP_YEAR, release: releaseLabel(), footer, story }),
				size
			)
		);
	const recap = await yearRecap(db, user.id, ANONYMOUS_ID);
	// The year's perfect scores when there are enough, like the page; otherwise the top
	const stars = recap.favoritesCount >= RECAP_STARS_MIN;
	const shown = stars
		? recap.favorites.slice(0, story ? STORY_STARS : OG_STARS)
		: recap.top.slice(0, story ? 5 : 3);
	const images = await Promise.all(shown.map((t) => loadImage(t.posterUrl, url.origin)));
	const card = {
		recap,
		name: user.displayName || user.username,
		footer,
		stars,
		posters: shown.map((t, i) => ({ title: t.title, poster: images[i] }))
	};
	return pngResponse(await renderPng(story ? recapStory(card) : recapCard(card), size));
};
