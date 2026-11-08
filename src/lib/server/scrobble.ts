// Turns a "watched" event from a media server into library progress (runs in the worker).
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { importMedia, type Providers } from './catalogue';
import type { Db } from './db';
import {
	episodes,
	episodeViews,
	integrations,
	libraryEntries,
	media,
	mediaExternalIds,
	mediaTitles,
	seasons
} from './db/schema';
import type { JellyfinEvent } from './jellyfin';
import { addToLibrary, updateEntry } from './library';

export type ScrobbleResult = 'updated' | 'unchanged' | 'duplicate' | 'unmatched' | 'ignored';
export type RecentEvent = { at: string; label: string; result: ScrobbleResult };

export const eventLabel = (e: JellyfinEvent) =>
	e.kind === 'episode'
		? `${e.seriesName ?? e.name} S${e.season ?? '?'}E${e.episode ?? '?'}`
		: e.year
			? `${e.name} (${e.year})`
			: e.name;

/** Lowercase, no accents, letters and digits only: "Frieren: Beyond…" -> "frierenbeyond…" */
const normalize = (s: string) =>
	s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '');

const SAME_TITLE = 0.6; // trigram similarity for "this is the same show" within a library

async function byExternalId(db: Db, provider: 'tmdb' | 'imdb', id: string, type: 'movie') {
	const [row] = await db
		.select({ id: media.id })
		.from(mediaExternalIds)
		.innerJoin(media, eq(media.id, mediaExternalIds.mediaId))
		.where(
			and(
				eq(mediaExternalIds.provider, provider),
				eq(mediaExternalIds.externalId, id),
				eq(media.type, type)
			)
		);
	return row?.id ?? null;
}

async function findMovie(db: Db, providers: Providers, e: JellyfinEvent) {
	if (e.tmdb) {
		const id = await byExternalId(db, 'tmdb', e.tmdb, 'movie');
		if (id) return id;
	}
	if (e.imdb) {
		const id = await byExternalId(db, 'imdb', e.imdb, 'movie');
		if (id) return id;
	}
	return e.tmdb ? importMedia(db, providers, 'movie', e.tmdb) : null;
}

/** Best title match among TV shows and anime, in the user's library or the whole catalogue. */
async function bestTitleMatch(db: Db, name: string, userId: string | null, threshold: number) {
	const q = sql`f_unaccent(lower(${name}))`;
	const score = sql<number>`max(similarity(f_unaccent(lower(${mediaTitles.title})), ${q}))`;
	let query = db
		.select({ id: media.id, score: score.mapWith(Number) })
		.from(mediaTitles)
		.innerJoin(media, eq(media.id, mediaTitles.mediaId))
		.$dynamic();
	if (userId) {
		query = query.innerJoin(
			libraryEntries,
			and(eq(libraryEntries.mediaId, media.id), eq(libraryEntries.userId, userId))
		);
	}
	const [best] = await query
		.where(
			and(inArray(media.type, ['tv', 'anime']), sql`${q} % f_unaccent(lower(${mediaTitles.title}))`)
		)
		.groupBy(media.id)
		.orderBy(desc(score))
		.limit(1);
	return best && best.score >= threshold ? best.id : null;
}

/**
 * Episodes carry no series id: match the series name in the user's library first (their
 * anime are often AniList entries titled differently), then the catalogue, then the providers
 * (exact title only, to avoid adding the wrong show).
 */
async function findSeries(db: Db, providers: Providers, userId: string, e: JellyfinEvent) {
	const name = e.seriesName;
	if (!name) return null;
	const inLibrary = await bestTitleMatch(db, name, userId, SAME_TITLE);
	if (inLibrary) return inLibrary;
	const inCatalogue = await bestTitleMatch(db, name, null, 0.9);
	if (inCatalogue) return inCatalogue;

	for (const type of ['tv', 'anime'] as const) {
		const { client } = providers[type];
		const results = await client.search(name, type).catch(() => []);
		const exact = results.find(
			(r) =>
				!r.isAdult &&
				(normalize(r.title) === normalize(name) ||
					(r.originalTitle && normalize(r.originalTitle) === normalize(name)))
		);
		if (exact) return importMedia(db, providers, type, exact.externalId);
	}
	return null;
}

/** Progress reached by this episode, and the episode row when the calendar sync knows it. */
async function episodeTarget(db: Db, mediaId: number, type: string, e: JellyfinEvent) {
	const number = e.episodeEnd ?? e.episode; // double episodes ("E01-E02") count to the end
	if (number === null) return null;
	if (type === 'anime') return { target: number, episodeId: null }; // one AniList entry per season

	const [row] = await db
		.select({ id: episodes.id, absolute: episodes.absoluteNumber })
		.from(episodes)
		.innerJoin(seasons, eq(seasons.id, episodes.seasonId))
		.where(
			and(
				eq(episodes.mediaId, mediaId),
				eq(seasons.number, e.season ?? 1),
				eq(episodes.number, number)
			)
		);
	if (row?.absolute) return { target: row.absolute, episodeId: row.id };
	// Without synced episodes, season 1 numbering is the absolute one
	return (e.season ?? 1) <= 1 ? { target: number, episodeId: row?.id ?? null } : null;
}

const isUniqueViolation = (err: unknown) => {
	const e = err as { code?: string; cause?: { code?: string } };
	return e.code === '23505' || e.cause?.code === '23505';
};

/** Applies one watched movie or episode to the user's library. */
export async function scrobble(
	db: Db,
	providers: Providers,
	userId: string,
	e: JellyfinEvent,
	source: 'jellyfin' = 'jellyfin'
): Promise<ScrobbleResult> {
	if (!e.watched) return 'ignored';
	const mediaId =
		e.kind === 'movie'
			? await findMovie(db, providers, e)
			: await findSeries(db, providers, userId, e);
	if (!mediaId) return 'unmatched';

	const [m] = await db.select({ type: media.type }).from(media).where(eq(media.id, mediaId));
	const episode = m.type === 'movie' ? null : await episodeTarget(db, mediaId, m.type, e);
	if (m.type !== 'movie' && !episode) return 'unmatched';

	const entryId = await addToLibrary(db, userId, mediaId);
	let changed = false;
	let result: boolean | 'duplicate';
	try {
		result = await updateEntry(
			db,
			userId,
			entryId,
			(current) => {
				// Only ever moves forward: rewatching an old episode does not lower progress
				const patch =
					m.type === 'movie'
						? current.status === 'completed'
							? {}
							: { status: 'completed' as const }
						: episode!.target > current.progress
							? { progress: episode!.target }
							: {};
				changed = Object.keys(patch).length > 0;
				return patch;
			},
			// Play stop and "marked as played" often both arrive for one viewing: once per day
			{ source, dedupKey: `${source}:${e.itemId}:${new Date().toISOString().slice(0, 10)}` }
		);
	} catch (err) {
		if (isUniqueViolation(err)) return 'duplicate';
		throw err;
	}
	if (result === 'duplicate') return 'duplicate';
	if (episode?.episodeId) {
		await db
			.insert(episodeViews)
			.values({ userId, episodeId: episode.episodeId })
			.onConflictDoNothing();
	}
	return changed ? 'updated' : 'unchanged';
}

/** Keeps the last 20 events on the integration, shown on the integrations page for checking. */
export async function recordEvent(db: Db, integrationId: number, event: RecentEvent) {
	await db
		.update(integrations)
		.set({
			lastSyncedAt: new Date(),
			// Prepend, then drop index 20: the list never exceeds 20 entries
			settings: sql`jsonb_set(${integrations.settings}, '{recent}',
				(jsonb_build_array(${JSON.stringify(event)}::jsonb)
				|| coalesce(${integrations.settings}->'recent', '[]'::jsonb)) - 20)`
		})
		.where(eq(integrations.id, integrationId));
}
