// Trakt API (import source only): watched movies and shows, ratings and watchlist of a public
// profile, or of a private one through OAuth (authorization code with PKCE, exchanged here, then
// revoked). Needs a Trakt application's client id (https://trakt.tv/oauth/applications), no secret.
// Docs: https://trakt.docs.apiary.io — 1000 GET requests per 5 minutes, 250 items per page.
import type { ImportItem } from '../imports/types';
import {
	createRateLimiter,
	fetchJson,
	ProviderError,
	USER_AGENT,
	type Fetch,
	type RateLimiter
} from './http';

const BASE = 'https://api.trakt.tv';
const PAGE = 250; // largest page Trakt serves
const MAX_PAGES = 200; // 50 000 items per list, far beyond any real profile

type Ids = { trakt: number; slug?: string; tmdb?: number | null };
type Work = { title: string; year: number | null; ids: Ids };
type Watched = { plays: number; last_watched_at: string | null; movie?: Work; show?: Work };
type Rated = { rating: number; movie?: Work; show?: Work };
type Listed = { movie?: Work; show?: Work };
type HistoryEpisode = { episode: { season: number; number: number }; show: Work };

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
const keyOf = (type: 'movie' | 'tv', w: Work) =>
	`${type}:${w.ids.tmdb ?? w.ids.slug ?? w.ids.trakt}`;

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

	/** Every page of a list; null when the profile is unknown. */
	async function getAll<T>(path: string, auth: Record<string, string>): Promise<T[] | null> {
		const all: T[] = [];
		for (let page = 1; page <= MAX_PAGES; page++) {
			const items = await fetchJson<T[]>('trakt', `${BASE}${path}?page=${page}&limit=${PAGE}`, {
				fetch,
				limiter,
				headers: { ...headers, ...auth }
			});
			if (items === null) return page === 1 ? null : all;
			all.push(...items);
			if (items.length < PAGE) break;
		}
		return all;
	}

	/** Body of a call to Trakt's OAuth endpoints (PKCE: the client id, no secret). */
	const oauthBody = (body: Record<string, string>) =>
		JSON.stringify({ ...body, client_id: opts.clientId });

	return {
		/**
		 * Trades the code Trakt sent to the redirect URI for an access token; null if refused.
		 * `codeVerifier` is the PKCE secret whose hash went with the sign-in link.
		 */
		async exchangeCode(
			code: string,
			redirectUri: string,
			codeVerifier: string
		): Promise<string | null> {
			try {
				const res = await fetchJson<{ access_token: string }>('trakt', `${BASE}/oauth/token`, {
					fetch,
					limiter,
					method: 'POST',
					headers,
					body: oauthBody({
						code,
						redirect_uri: redirectUri,
						grant_type: 'authorization_code',
						code_verifier: codeVerifier
					})
				});
				return res?.access_token ?? null;
			} catch (err) {
				// An expired, reused or forged code answers 400/401
				if (err instanceof ProviderError && err.status < 500) return null;
				throw err;
			}
		},

		/** The token is only needed for one import: give it back. */
		async revoke(token: string): Promise<void> {
			await limiter();
			// Answers 200 with an empty body, hence no fetchJson
			await fetch(`${BASE}/oauth/revoke`, {
				method: 'POST',
				headers: { ...headers, 'User-Agent': USER_AGENT },
				body: oauthBody({ token })
			});
		},

		/**
		 * The user's library as import rows; null when the profile is private or unknown.
		 * With an access token, `userName` is "me" and private profiles are readable.
		 */
		async userLibrary(userName: string, accessToken?: string): Promise<ImportItem[] | null> {
			const user = encodeURIComponent(userName);
			const auth: Record<string, string> = accessToken
				? { Authorization: `Bearer ${accessToken}` }
				: {};
			let data;
			try {
				data = await Promise.all([
					getAll<Listed>(`/users/${user}/watchlist/movies`, auth),
					getAll<Listed>(`/users/${user}/watchlist/shows`, auth),
					getAll<Watched>(`/users/${user}/watched/movies`, auth),
					getAll<Watched>(`/users/${user}/watched/shows`, auth),
					getAll<Rated>(`/users/${user}/ratings/movies`, auth),
					getAll<Rated>(`/users/${user}/ratings/shows`, auth),
					// watched/shows no longer lists seasons: count episodes from the history instead
					getAll<HistoryEpisode>(`/users/${user}/history/episodes`, auth)
				]);
			} catch (err) {
				// Private profiles answer 401/403 without OAuth
				if (err instanceof ProviderError && (err.status === 401 || err.status === 403)) return null;
				throw err;
			}
			if (data.every((d) => d === null)) return null;
			const [watchMovies, watchShows, watchedMovies, watchedShows, rateMovies, rateShows, history] =
				data;

			// Distinct episodes seen per show; specials (season 0) are outside TMDB's episode total
			const seen = new Map<string, Set<string>>();
			for (const h of history ?? []) {
				if (h.episode.season <= 0) continue;
				const key = keyOf('tv', h.show);
				if (!seen.has(key)) seen.set(key, new Set());
				seen.get(key)!.add(`${h.episode.season}x${h.episode.number}`);
			}

			const items = new Map<string, ImportItem>();
			/** One row per title; later sources (watched, ratings) refine earlier ones (watchlist). */
			const row = (type: 'movie' | 'tv', w: Work) => {
				const key = keyOf(type, w);
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
				// Without history (hidden), plays is the best estimate; it is capped at the
				// episode total on import. Completed automatically when every episode was seen.
				const episodes = seen.get(keyOf('tv', w.show))?.size ?? w.plays;
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
