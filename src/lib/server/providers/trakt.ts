// Trakt API (import source only): watched movies and shows, ratings and watchlist of a public
// profile. Needs a Trakt application's client id (https://trakt.tv/oauth/applications).
// Docs: https://trakt.docs.apiary.io — 1000 GET requests per 5 minutes.
import type { ImportItem } from '../imports/types';
import { createRateLimiter, fetchJson, ProviderError, type Fetch, type RateLimiter } from './http';

const BASE = 'https://api.trakt.tv';

type Ids = { trakt: number; slug?: string; tmdb?: number | null };
type Work = { title: string; year: number | null; ids: Ids };
type Watched = {
	plays: number;
	last_watched_at: string | null;
	movie?: Work;
	show?: Work;
	seasons?: { number: number; episodes: { number: number }[] }[];
};
type Rated = { rating: number; movie?: Work; show?: Work };
type Listed = { movie?: Work; show?: Work };

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

export function createTraktClient(opts: {
	clientId: string;
	fetch?: Fetch;
	limiter?: RateLimiter;
}) {
	const fetch = opts.fetch ?? globalThis.fetch;
	const limiter = opts.limiter ?? createRateLimiter(120);
	const headers = {
		'Content-Type': 'application/json',
		'trakt-api-version': '2',
		'trakt-api-key': opts.clientId
	};
	const get = <T>(path: string) =>
		fetchJson<T>('trakt', `${BASE}${path}`, { fetch, limiter, headers });

	return {
		/** The user's library as import rows; null when the profile is private or unknown. */
		async userLibrary(userName: string): Promise<ImportItem[] | null> {
			const user = encodeURIComponent(userName);
			let data;
			try {
				data = await Promise.all([
					get<Listed[]>(`/users/${user}/watchlist/movies`),
					get<Listed[]>(`/users/${user}/watchlist/shows`),
					get<Watched[]>(`/users/${user}/watched/movies`),
					get<Watched[]>(`/users/${user}/watched/shows`),
					get<Rated[]>(`/users/${user}/ratings/movies`),
					get<Rated[]>(`/users/${user}/ratings/shows`)
				]);
			} catch (err) {
				// Private profiles answer 401/403 without OAuth
				if (err instanceof ProviderError && (err.status === 401 || err.status === 403)) return null;
				throw err;
			}
			if (data.every((d) => d === null)) return null;
			const [watchMovies, watchShows, watchedMovies, watchedShows, rateMovies, rateShows] = data;

			const items = new Map<string, ImportItem>();
			/** One row per title; later sources (watched, ratings) refine earlier ones (watchlist). */
			const row = (type: 'movie' | 'tv', w: Work) => {
				const key = `${type}:${w.ids.tmdb ?? w.ids.slug ?? w.ids.trakt}`;
				let item = items.get(key);
				if (!item) {
					item = {
						label: w.year ? `${w.title} (${w.year})` : w.title,
						type,
						...(w.ids.tmdb && {
							ref: { provider: 'tmdb' as const, externalId: String(w.ids.tmdb) }
						}),
						entry: {
							status: 'planned',
							progress: 0,
							progressSecondary: 0,
							score: null,
							startedOn: null,
							completedOn: null,
							repeatCount: 0,
							review: null,
							notes: null
						}
					};
					items.set(key, item);
				}
				return item.entry;
			};

			for (const l of watchMovies ?? []) if (l.movie) row('movie', l.movie);
			for (const l of watchShows ?? []) if (l.show) row('tv', l.show);
			for (const w of watchedMovies ?? []) {
				if (!w.movie) continue;
				Object.assign(row('movie', w.movie), {
					status: 'completed',
					completedOn: day(w.last_watched_at),
					repeatCount: Math.max(0, w.plays - 1)
				});
			}
			for (const w of watchedShows ?? []) {
				if (!w.show) continue;
				// Specials (season 0) are not counted in TMDB's episode total
				const episodes = (w.seasons ?? [])
					.filter((s) => s.number > 0)
					.reduce((n, s) => n + s.episodes.length, 0);
				// Completed automatically on import when every episode has been watched
				Object.assign(row('tv', w.show), { status: 'in_progress', progress: episodes });
			}
			for (const r of [...(rateMovies ?? []), ...(rateShows ?? [])]) {
				const work = r.movie ?? r.show;
				if (!work) continue;
				const entry = row(r.movie ? 'movie' : 'tv', work);
				entry.score = r.rating * 10; // Trakt ratings are out of 10
				if (entry.status === 'planned') entry.status = 'completed'; // rated means seen
			}
			return [...items.values()];
		}
	};
}

export type TraktClient = ReturnType<typeof createTraktClient>;
