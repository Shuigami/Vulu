// TMDB API v3 (movies, TV shows). Accepts either a v3 API key or a v4 read access token.
// https://developer.themoviedb.org/docs — stays well under the ~40 requests/second limit.
import { createRateLimiter, fetchJson, type Fetch, type RateLimiter } from './http';
import {
	plainText,
	uniqueTitles,
	yearOf,
	type MediaType,
	type ProviderClient,
	type ProviderEpisodes,
	type ProviderMedia,
	type SearchResult
} from './types';

const BASE = 'https://api.themoviedb.org/3';
const LANGUAGE = 'fr-FR';
const image = (path: string | null | undefined, size: 'w342' | 'w780' | 'w1280') =>
	path ? `https://image.tmdb.org/t/p/${size}${path}` : null;

type SearchItem = {
	id: number;
	title?: string; // movie
	name?: string; // tv
	original_title?: string;
	original_name?: string;
	release_date?: string;
	first_air_date?: string;
	poster_path: string | null;
	adult?: boolean;
	genre_ids?: number[];
	origin_country?: string[]; // tv
};
type SeasonSummary = {
	season_number: number;
	name: string | null;
	air_date: string | null;
	episode_count: number | null;
	poster_path: string | null;
};
type SeasonDetail = {
	episodes?: {
		episode_number: number;
		name: string | null;
		air_date: string | null;
		runtime: number | null;
	}[];
};
type Details = SearchItem & {
	overview: string | null;
	status: string | null;
	backdrop_path: string | null;
	runtime?: number | null; // movie
	episode_run_time?: number[]; // tv
	last_air_date?: string | null;
	number_of_episodes?: number | null;
	number_of_seasons?: number | null;
	genres?: { id: number; name: string }[];
	original_language?: string;
	external_ids?: { imdb_id?: string | null; tvdb_id?: number | null };
	alternative_titles?: {
		titles?: { title: string; iso_3166_1: string }[];
		results?: { title: string; iso_3166_1: string }[];
	};
};

const STATUS: Record<string, ProviderMedia['media']['status']> = {
	Released: 'finished',
	Ended: 'finished',
	'Returning Series': 'releasing',
	Canceled: 'cancelled',
	Rumored: 'announced',
	Planned: 'announced',
	'In Production': 'announced',
	'Post Production': 'announced',
	Pilot: 'announced'
};

const ANIMATION_GENRE = 16;
/** Japanese animated series: AniList is the source of truth for anime (docs/v1-spec.md). */
const isAnime = (r: SearchItem) =>
	!!r.origin_country?.includes('JP') && !!r.genre_ids?.includes(ANIMATION_GENRE);

const toResults = (items: SearchItem[] | undefined, type: MediaType) =>
	(items ?? [])
		.filter((r) => !isAnime(r))
		.map((r): SearchResult => ({
			provider: 'tmdb',
			externalId: String(r.id),
			type,
			title: r.title ?? r.name ?? '?',
			originalTitle: r.original_title ?? r.original_name ?? null,
			year: yearOf(r.release_date ?? r.first_air_date),
			posterUrl: image(r.poster_path, 'w342'),
			isAdult: r.adult ?? false
		}));

export function createTmdbClient(opts: {
	apiKey: string;
	fetch?: Fetch;
	limiter?: RateLimiter;
}): ProviderClient {
	const fetch = opts.fetch ?? globalThis.fetch;
	const limiter = opts.limiter ?? createRateLimiter(600);
	// v4 read access tokens are JWTs; v3 keys go in the query string
	const isToken = opts.apiKey.startsWith('eyJ');

	function get<T>(path: string, params: Record<string, string>) {
		const query = new URLSearchParams({
			language: LANGUAGE,
			...params,
			...(!isToken && { api_key: opts.apiKey })
		});
		return fetchJson<T>('tmdb', `${BASE}${path}?${query}`, {
			fetch,
			limiter,
			headers: isToken ? { Authorization: `Bearer ${opts.apiKey}` } : {}
		});
	}

	const kind = (type: MediaType) => {
		if (type === 'movie' || type === 'tv') return type;
		throw new Error(`TMDB client does not handle ${type}`);
	};

	return {
		types: ['movie', 'tv'],

		async search(q, type) {
			const res = await get<{ results: SearchItem[] }>(`/search/${kind(type)}`, {
				query: q,
				include_adult: 'false'
			});
			return toResults(res?.results, type);
		},

		async trending(type) {
			const res = await get<{ results: SearchItem[] }>(`/trending/${kind(type)}/week`, {});
			return toResults(res?.results, type);
		},

		async recommendations(id, type) {
			const k = kind(type);
			const res = await get<{ results: SearchItem[] }>(
				`/${k}/${encodeURIComponent(id)}/recommendations`,
				{}
			);
			return toResults(res?.results, type);
		},

		async get(id, type) {
			const k = kind(type);
			const d = await get<Details>(`/${k}/${encodeURIComponent(id)}`, {
				append_to_response: 'external_ids,alternative_titles'
			});
			if (!d) return null;
			const isMovie = k === 'movie';
			const title = d.title ?? d.name ?? '?';
			const original = d.original_title ?? d.original_name ?? null;
			const alternatives = d.alternative_titles?.titles ?? d.alternative_titles?.results ?? [];
			const imdb = d.external_ids?.imdb_id;
			const tvdb = d.external_ids?.tvdb_id;

			return {
				media: {
					type: k,
					title,
					originalTitle: original !== title ? original : null,
					overview: plainText(d.overview),
					status: (d.status ? STATUS[d.status] : null) ?? null,
					startDate: d.release_date || d.first_air_date || null,
					endDate: isMovie ? null : d.status === 'Ended' ? (d.last_air_date ?? null) : null,
					posterUrl: image(d.poster_path, 'w780'),
					backdropUrl: image(d.backdrop_path, 'w1280'),
					runtimeMinutes: isMovie ? (d.runtime ?? null) : (d.episode_run_time?.[0] ?? null),
					totalUnits: isMovie ? null : (d.number_of_episodes ?? null),
					totalUnitsSecondary: isMovie ? null : (d.number_of_seasons ?? null),
					isAdult: d.adult ?? false,
					extra: {
						genres: d.genres?.map((g) => g.name) ?? [],
						originalLanguage: d.original_language ?? null
					}
				},
				externalIds: [
					{ provider: 'tmdb', externalId: String(d.id) },
					...(imdb ? [{ provider: 'imdb' as const, externalId: imdb }] : []),
					...(tvdb ? [{ provider: 'tvdb' as const, externalId: String(tvdb) }] : [])
				],
				titles: uniqueTitles([
					{ title, locale: null }, // French when TMDB has a translation, original otherwise
					{ title: original, locale: d.original_language ?? null },
					...alternatives
						.filter((a) => ['FR', 'US', 'GB', 'JP'].includes(a.iso_3166_1))
						.map((a) => ({ title: a.title, locale: null }))
				])
			};
		},

		async episodes(id, type) {
			if (type !== 'tv') return null;
			const show = await get<{ seasons?: SeasonSummary[] }>(`/tv/${encodeURIComponent(id)}`, {});
			if (!show) return null;
			const summaries = (show.seasons ?? []).sort((a, b) => a.season_number - b.season_number);

			// TMDB appends up to 20 sub-requests to one call: fetch seasons 20 at a time
			const details: Record<string, SeasonDetail | undefined> = {};
			for (let i = 0; i < summaries.length; i += 20) {
				const chunk = summaries.slice(i, i + 20).map((s) => `season/${s.season_number}`);
				Object.assign(
					details,
					await get(`/tv/${encodeURIComponent(id)}`, { append_to_response: chunk.join(',') })
				);
			}

			let absolute = 0;
			const episodes: ProviderEpisodes['episodes'] = [];
			for (const s of summaries) {
				for (const e of details[`season/${s.season_number}`]?.episodes ?? []) {
					episodes.push({
						seasonNumber: s.season_number,
						number: e.episode_number,
						// Specials (season 0) stay out of the absolute numbering
						absoluteNumber: s.season_number > 0 ? ++absolute : null,
						title: e.name || null,
						airDate: e.air_date ? new Date(`${e.air_date}T00:00:00Z`) : null,
						runtimeMinutes: e.runtime ?? null
					});
				}
			}
			return {
				upcomingOnly: false,
				seasons: summaries.map((s) => ({
					number: s.season_number,
					title: s.name || null,
					airDate: s.air_date || null,
					episodeCount: s.episode_count ?? null,
					posterUrl: image(s.poster_path, 'w342')
				})),
				episodes
			};
		}
	};
}
