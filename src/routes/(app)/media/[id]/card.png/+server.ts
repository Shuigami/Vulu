import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/app.ts';
import { mediaCard } from '#lib/server/cards/cards.ts';
import { loadImage, OG, pngResponse, renderPng } from '#lib/server/cards/render.ts';
import { libraryEntries, media, users } from '#lib/server/db/schema.ts';
import { ANONYMOUS_ID } from '#lib/server/guard.ts';
import { ratingSummary, visibleTo } from '#lib/server/social.ts';
import { activityVerb, toScale } from '#lib/labels.ts';
import type { RequestHandler } from './$types';

/** The work's card; with `?par=<username>`, that member's entry (if public) instead of the average. */
export const GET: RequestHandler = async ({ params, url }) => {
	const id = Number(params.id);
	const [m] =
		Number.isInteger(id) && id > 0 ? await db.select().from(media).where(eq(media.id, id)) : [];
	if (!m || m.isAdult) error(404);
	const username = url.searchParams.get('par');
	const [entry] = username
		? await db
				.select({
					name: users.displayName,
					username: users.username,
					scale: users.ratingScale,
					status: libraryEntries.status,
					score: libraryEntries.score
				})
				.from(libraryEntries)
				.innerJoin(users, eq(users.id, libraryEntries.userId))
				.where(
					and(eq(libraryEntries.mediaId, id), eq(users.username, username), visibleTo(ANONYMOUS_ID))
				)
		: [];
	const [ratings, poster] = await Promise.all([
		ratingSummary(db, id, ANONYMOUS_ID),
		loadImage(m.posterUrl, url.origin)
	]);
	const read = m.type === 'manga' || m.type === 'book';
	const verb = !entry
		? ''
		: entry.status === 'completed'
			? activityVerb(['completed'], m.type)
			: entry.status === 'planned'
				? read
					? 'veut lire'
					: 'veut voir'
				: read
					? 'lit'
					: 'regarde';
	const card = mediaCard({
		host: url.host,
		title: m.title,
		type: m.type,
		year: m.startDate ? Number(m.startDate.slice(0, 4)) : null,
		poster,
		by: entry
			? {
					name: entry.name || `@${entry.username}`,
					verb,
					score: entry.score === null ? null : `${toScale(entry.score, entry.scale)}/${entry.scale}`
				}
			: null,
		average: ratings.average === null ? null : `${toScale(ratings.average, 10)}/10`,
		ratings: ratings.count
	});
	return pngResponse(await renderPng(card, OG));
};
