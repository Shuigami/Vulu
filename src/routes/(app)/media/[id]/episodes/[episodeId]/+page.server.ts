import { error, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, getBoss } from '#lib/server/app.ts';
import { QUEUES } from '#lib/server/jobs.ts';
import { requireUser, viewerId as viewerOf } from '#lib/server/guard.ts';
import { libraryEntries, media } from '#lib/server/db/schema.ts';
import { episodePage, markEpisode, rateEpisode } from '#lib/server/episodes.ts';
import { fromScale } from '#lib/labels.ts';
import type { Actions, PageServerLoad } from './$types';

const parseId = (raw: string) => {
	const id = Number(raw);
	if (!Number.isInteger(id) || id <= 0) error(404, 'Épisode introuvable');
	return id;
};

export const load: PageServerLoad = async ({ params, locals }) => {
	const mediaId = parseId(params.id);
	const viewerId = viewerOf(locals);
	const [m] = await db
		.select({ id: media.id, title: media.title, type: media.type, posterUrl: media.posterUrl })
		.from(media)
		.where(eq(media.id, mediaId));
	if (!m) error(404, 'Œuvre introuvable');
	const [entry] = await db
		.select({ progress: libraryEntries.progress, startedOn: libraryEntries.startedOn })
		.from(libraryEntries)
		.where(and(eq(libraryEntries.mediaId, mediaId), eq(libraryEntries.userId, viewerId)));
	const episode = await episodePage(
		db,
		mediaId,
		parseId(params.episodeId),
		viewerId,
		entry ?? null
	);
	if (!episode) error(404, 'Épisode introuvable');
	// Episodes synced before synopses and stills were stored: fetch them again once
	if (episode.stale)
		getBoss()
			.then((boss) =>
				boss.send(QUEUES.syncEpisodes, { mediaId }, { singletonKey: `episodes:${mediaId}` })
			)
			.catch((err) => console.error('[episode] episode sync not queued', err));
	return { media: m, episode };
};

export const actions: Actions = {
	episode: async ({ params, request, locals, url }) => {
		const userId = requireUser(locals, url).id;
		const seen = (await request.formData()).get('seen') === 'true';
		const ok = await markEpisode(db, userId, parseId(params.id), parseId(params.episodeId), seen);
		if (!ok) error(404, 'Épisode introuvable');
	},

	// The score travels in the user's scale; empty clears it
	rate: async ({ params, request, locals, url }) => {
		const user = requireUser(locals, url);
		const scale = user.ratingScale ?? 5;
		const raw = String((await request.formData()).get('score') ?? '').replace(',', '.');
		const value = Number(raw);
		if (raw !== '' && !(value >= 0 && value <= scale))
			return fail(400, { error: `La note doit être comprise entre 0 et ${scale}.` });
		const ok = await rateEpisode(
			db,
			user.id,
			parseId(params.id),
			parseId(params.episodeId),
			raw === '' ? null : fromScale(value, scale)
		);
		if (!ok) error(404, 'Épisode introuvable');
	}
};
