import { error, fail } from '@sveltejs/kit';
import { and, desc, eq, sum } from 'drizzle-orm';
import { db, getBoss } from '#lib/server/app.ts';
import { QUEUES } from '#lib/server/jobs.ts';
import { requireUser, viewerId as viewerOf } from '#lib/server/guard.ts';
import {
	describeAirDate,
	episodeLabel,
	nextEpisode,
	startOfToday,
	timeAgo
} from '#lib/server/calendar.ts';
import { activityEvents, libraryEntries, media, mediaExternalIds } from '#lib/server/db/schema.ts';
import {
	addToLibrary,
	removeEntry,
	rewatchEntry,
	updateEntry,
	type EntryPatch
} from '#lib/server/library.ts';
import {
	addToList,
	createList,
	listsForMedia,
	parseListInput,
	removeFromList
} from '#lib/server/lists.ts';
import { markEpisode, markSeason, seasonList } from '#lib/server/episodes.ts';
import { likeReview, mediaEntries, ratingSummary } from '#lib/server/social.ts';
import { fromScale, isEntryStatus } from '#lib/labels.ts';
import type { Actions, PageServerLoad } from './$types';

const parseId = (raw: string) => {
	const id = Number(raw);
	if (!Number.isInteger(id) || id <= 0) error(404, 'Œuvre introuvable');
	return id;
};

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const id = parseId(params.id);
	const [m] = await db.select().from(media).where(eq(media.id, id));
	if (!m) error(404, 'Œuvre introuvable');
	const [entry] = await db
		.select()
		.from(libraryEntries)
		.where(and(eq(libraryEntries.mediaId, id), eq(libraryEntries.userId, viewerOf(locals))));
	const externalIds = await db
		.select({ provider: mediaExternalIds.provider, externalId: mediaExternalIds.externalId })
		.from(mediaExternalIds)
		.where(eq(mediaExternalIds.mediaId, id));
	const next = await nextEpisode(db, id, startOfToday());
	const upcoming = next && {
		episode: episodeLabel(next),
		...describeAirDate(next.airDate!)
	};
	const viewerId = viewerOf(locals);
	const franchise = m.type === 'anime' && !!m.totalUnitsSecondary;
	const mine = and(eq(activityEvents.mediaId, id), eq(activityEvents.userId, viewerId));
	const [ratings, followed, reviews, journal, [time], lists, seasons] = await Promise.all([
		ratingSummary(db, id, viewerId),
		mediaEntries(db, id, viewerId, { followedOnly: true, limit: 24 }),
		mediaEntries(db, id, viewerId, { reviewsOnly: true }),
		db
			.select({
				id: activityEvents.id,
				kind: activityEvents.kind,
				amount: activityEvents.amount,
				source: activityEvents.source,
				occurredAt: activityEvents.occurredAt
			})
			.from(activityEvents)
			.where(mine)
			.orderBy(desc(activityEvents.occurredAt), desc(activityEvents.id))
			.limit(12),
		db
			.select({ minutes: sum(activityEvents.minutes).mapWith(Number) })
			.from(activityEvents)
			.where(mine),
		listsForMedia(db, viewerId, id),
		// Anime without a TMDB match only have their upcoming episodes: the progress grid stays.
		// Franchises (AniList seasons chained, docs/franchises-anime.md) always have theirs.
		m.type === 'tv' || franchise || typeof m.extra.tmdbId === 'string'
			? seasonList(db, id, viewerId, entry ?? null)
			: []
	]);
	// Imports only fetch episodes of airing shows: fetch a finished show's on its first visit.
	// Anime never matched on TMDB (`tmdbId` absent; null once tried) get their first try.
	const animeUntried =
		m.type === 'anime' && m.extra.format !== 'MOVIE' && !!m.startDate && !('tmdbId' in m.extra);
	if (
		((m.type === 'tv' || (franchise && m.status !== 'announced')) && !seasons.length) ||
		animeUntried
	)
		getBoss()
			.then((boss) =>
				boss.send(QUEUES.syncEpisodes, { mediaId: id }, { singletonKey: `episodes:${id}` })
			)
			.catch((err) => console.error('[media] episode sync not queued', err));
	return {
		media: m,
		entry: entry ?? null,
		externalIds,
		upcoming,
		ratings,
		followed,
		reviews: reviews.map(({ updatedAt, ...r }) => ({ ...r, when: timeAgo(updatedAt) })),
		journal: journal.map(({ occurredAt, ...e }) => ({ ...e, when: timeAgo(occurredAt) })),
		minutesSpent: time?.minutes ?? 0,
		lists,
		seasons,
		// Shared link of someone's entry: the preview shows their card (checked by the card itself)
		by: url.searchParams.get('par')?.slice(0, 30) ?? null
	};
};

/** Validates the library form; returns the fields or an error message (French, shown in the UI). */
function parseEntryForm(form: FormData, ratingScale: number): EntryPatch | string {
	const int = (name: string) => {
		const v = Number(form.get(name) || 0);
		return Number.isInteger(v) && v >= 0 && v <= 1_000_000 ? v : null;
	};
	const date = (name: string) => {
		const v = String(form.get(name) ?? '');
		return v === '' ? null : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
	};
	const text = (name: string) =>
		String(form.get(name) ?? '')
			.trim()
			.slice(0, 5000) || null;

	const status = form.get('status');
	if (!isEntryStatus(status)) return 'Statut invalide.';
	const progress = int('progress');
	const progressSecondary = int('progressSecondary');
	const repeatCount = int('repeatCount');
	if (progress === null || progressSecondary === null || repeatCount === null)
		return 'Progression invalide.';

	const rawScore = String(form.get('score') ?? '').replace(',', '.');
	const scoreValue = Number(rawScore);
	if (rawScore !== '' && !(scoreValue >= 0 && scoreValue <= ratingScale))
		return `La note doit être comprise entre 0 et ${ratingScale}.`;
	const startedOn = date('startedOn');
	const completedOn = date('completedOn');
	if (startedOn === undefined || completedOn === undefined) return 'Date invalide.';

	return {
		status,
		progress,
		progressSecondary,
		repeatCount,
		score: rawScore === '' ? null : fromScale(scoreValue, ratingScale),
		startedOn,
		completedOn,
		notes: text('notes'),
		review: text('review'),
		reviewSpoiler: form.get('reviewSpoiler') === 'on',
		isFavorite: form.get('isFavorite') === 'on',
		isPrivate: form.get('isPrivate') === 'on'
	};
}

export const actions: Actions = {
	like: async ({ request, locals, url }) => {
		const form = await request.formData();
		const entryId = Number(form.get('entryId'));
		if (!Number.isInteger(entryId) || entryId <= 0) return fail(400);
		if (!(await likeReview(db, requireUser(locals, url).id, entryId, form.get('like') === 'true')))
			return fail(404);
	},
	toggleList: async ({ params, request, locals, url }) => {
		const form = await request.formData();
		const listId = Number(form.get('listId'));
		if (!Number.isInteger(listId)) return fail(400);
		const mediaId = parseId(params.id);
		const toggle = form.get('has') === 'true' ? removeFromList : addToList;
		await toggle(db, requireUser(locals, url).id, listId, mediaId);
	},
	newList: async ({ params, request, locals, url }) => {
		const input = parseListInput(await request.formData());
		if (typeof input === 'string') return fail(400, { listError: input });
		const listId = await createList(db, requireUser(locals, url).id, input);
		await addToList(db, requireUser(locals, url).id, listId, parseId(params.id));
	},
	add: async ({ params, request, locals, url }) => {
		const form = await request.formData();
		const status = form.get('status');
		const progress = Number(form.get('progress') ?? 0);
		// Quick add: an optional score out of 100
		const score = Number(form.get('score') || NaN);
		const entryId = await addToLibrary(db, requireUser(locals, url).id, parseId(params.id));
		// Added straight as "in progress" or "completed": the usual rules fill in dates and progress
		if (isEntryStatus(status) && status !== 'planned') {
			const patch: EntryPatch = { status };
			// Quick add sets where the user is; the rules cap it at the total
			if (status === 'in_progress' && Number.isInteger(progress) && progress > 0)
				patch.progress = Math.min(progress, 1_000_000);
			if (Number.isInteger(score) && score > 0 && score <= 100) patch.score = score;
			await updateEntry(db, requireUser(locals, url).id, entryId, patch);
		}
	},

	update: async ({ request, locals, url }) => {
		const form = await request.formData();
		const entryId = Number(form.get('entryId'));
		const parsed = parseEntryForm(form, requireUser(locals, url).ratingScale ?? 5);
		if (typeof parsed === 'string') return fail(400, { error: parsed });
		// Only send what changed, so automatic rules (e.g. completing at the last episode) apply
		const ok = await updateEntry(db, requireUser(locals, url).id, entryId, (current) =>
			Object.fromEntries(
				Object.entries(parsed).filter(([k, v]) => current[k as keyof typeof current] !== v)
			)
		);
		if (!ok) error(404, 'Entrée introuvable');
		return { saved: true };
	},

	// Found by media, so the quick add menu can call it without knowing the entry id
	rewatch: async ({ params, locals, url }) => {
		const userId = requireUser(locals, url).id;
		const [entry] = await db
			.select({ id: libraryEntries.id })
			.from(libraryEntries)
			.where(
				and(eq(libraryEntries.userId, userId), eq(libraryEntries.mediaId, parseId(params.id)))
			);
		if (!entry || !(await rewatchEntry(db, userId, entry.id))) error(404, 'Entrée introuvable');
	},

	episode: async ({ params, request, locals, url }) => {
		const form = await request.formData();
		const episodeId = Number(form.get('episodeId'));
		if (!Number.isInteger(episodeId)) return fail(400);
		const userId = requireUser(locals, url).id;
		const ok = await markEpisode(
			db,
			userId,
			parseId(params.id),
			episodeId,
			form.get('seen') === 'true'
		);
		if (!ok) error(404, 'Épisode introuvable');
	},

	season: async ({ params, request, locals, url }) => {
		const seasonId = Number((await request.formData()).get('seasonId'));
		if (!Number.isInteger(seasonId)) return fail(400);
		const userId = requireUser(locals, url).id;
		if (!(await markSeason(db, userId, parseId(params.id), seasonId)))
			error(404, 'Saison introuvable');
	},

	remove: async ({ request, locals, url }) => {
		const entryId = Number((await request.formData()).get('entryId'));
		await removeEntry(db, requireUser(locals, url).id, entryId);
	}
};
