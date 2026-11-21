// AniList GraphQL API (anime, manga). Public queries need no key.
// https://docs.anilist.co — rate limit 90 requests/minute, lowered to 30 while AniList is degraded
// (X-RateLimit-Limit says 30 in 2026).
import type { ImportItem } from '../imports/types';
import { createRateLimiter, fetchJson, ProviderError, type Fetch, type RateLimiter } from './http';
import {
	plainText,
	uniqueTitles,
	yearOf,
	type FranchiseSeason,
	type MediaType,
	type ProviderClient,
	type ProviderMedia,
	type SearchResult
} from './types';

const URL = 'https://graphql.anilist.co';

type FuzzyDate = { year: number | null; month: number | null; day: number | null } | null;
type AniMedia = {
	id: number;
	idMal: number | null;
	type: 'ANIME' | 'MANGA';
	format: string | null;
	status: 'FINISHED' | 'RELEASING' | 'NOT_YET_RELEASED' | 'CANCELLED' | 'HIATUS' | null;
	title: { romaji: string | null; english: string | null; native: string | null };
	synonyms: string[] | null;
	description: string | null;
	startDate: FuzzyDate;
	endDate: FuzzyDate;
	episodes: number | null;
	duration: number | null;
	chapters: number | null;
	volumes: number | null;
	coverImage: { extraLarge: string | null; large: string | null } | null;
	bannerImage: string | null;
	genres: string[] | null;
	isAdult: boolean;
	studios: { nodes: { name: string }[] } | null;
	relations?: {
		edges: {
			relationType: string;
			node: { id: number; format: string | null; startDate?: FuzzyDate };
		}[];
	};
};

const FIELDS = `id idMal type format status title { romaji english native } synonyms
  startDate { year month day } coverImage { extraLarge large } isAdult`;
const DETAIL_FIELDS = `${FIELDS} description(asHtml: false) endDate { year month day }
  episodes duration chapters volumes bannerImage genres studios(isMain: true) { nodes { name } }`;

type ListCollection = {
	hasNextChunk: boolean;
	lists: {
		isCustomList: boolean;
		entries: {
			status: keyof typeof LIST_STATUS;
			score: number | null;
			progress: number | null;
			progressVolumes: number | null;
			repeat: number | null;
			notes: string | null;
			startedAt: FuzzyDate;
			completedAt: FuzzyDate;
			media: AniMedia;
		}[];
	}[];
};

const LIST_STATUS = {
	CURRENT: 'in_progress',
	REPEATING: 'in_progress',
	PLANNING: 'planned',
	COMPLETED: 'completed',
	PAUSED: 'paused',
	DROPPED: 'dropped'
} as const;

const STATUS = {
	FINISHED: 'finished',
	RELEASING: 'releasing',
	NOT_YET_RELEASED: 'announced',
	CANCELLED: 'cancelled',
	HIATUS: 'hiatus'
} as const;

const toDate = (d: FuzzyDate) =>
	d?.year
		? `${d.year}-${String(d.month ?? 1).padStart(2, '0')}-${String(d.day ?? 1).padStart(2, '0')}`
		: null;

const displayTitle = (m: AniMedia) => m.title.english ?? m.title.romaji ?? m.title.native ?? '?';

const toSearchResult = (m: AniMedia): SearchResult => ({
	provider: 'anilist',
	externalId: String(m.id),
	type: m.type === 'ANIME' ? 'anime' : 'manga',
	title: displayTitle(m),
	originalTitle: m.title.native,
	year: yearOf(toDate(m.startDate)),
	posterUrl: m.coverImage?.large ?? null,
	isAdult: m.isAdult
});

function toProviderMedia(m: AniMedia): ProviderMedia {
	const isAnime = m.type === 'ANIME';
	return {
		media: {
			type: isAnime ? 'anime' : 'manga',
			title: displayTitle(m),
			originalTitle: m.title.native,
			overview: plainText(m.description),
			status: m.status ? STATUS[m.status] : null,
			startDate: toDate(m.startDate),
			endDate: toDate(m.endDate),
			posterUrl: m.coverImage?.extraLarge ?? m.coverImage?.large ?? null,
			backdropUrl: m.bannerImage,
			runtimeMinutes: isAnime ? m.duration : null,
			totalUnits: isAnime ? m.episodes : m.chapters,
			totalUnitsSecondary: isAnime ? null : m.volumes,
			isAdult: m.isAdult,
			extra: {
				format: m.format,
				genres: m.genres ?? [],
				...(isAnime && { studios: m.studios?.nodes.map((s) => s.name) ?? [] })
			}
		},
		externalIds: [
			{ provider: 'anilist', externalId: String(m.id) },
			...(m.idMal ? [{ provider: 'mal' as const, externalId: String(m.idMal) }] : [])
		],
		titles: uniqueTitles([
			{ title: m.title.english, locale: 'en' },
			{ title: m.title.romaji, locale: 'ja-Latn' },
			{ title: m.title.native, locale: 'ja' },
			...(m.synonyms ?? []).map((title) => ({ title, locale: null }))
		])
	};
}

/**
 * One work for a chain of AniList seasons (docs/franchises-anime.md): the first season's
 * details, the last one's end, every season's ids and titles.
 */
function toFranchise(chain: AniMedia[]): ProviderMedia {
	const [first, last] = [chain[0], chain.at(-1)!];
	const base = toProviderMedia(first);
	const parts = chain.map(toProviderMedia);
	const counts = chain.map((m) => m.episodes);
	return {
		media: {
			...base.media,
			endDate: toDate(last.endDate),
			// A season airing makes the franchise airing; otherwise the last season tells
			status: chain.some((m) => m.status === 'RELEASING')
				? 'releasing'
				: last.status
					? STATUS[last.status]
					: null,
			totalUnits: counts.every((c) => c !== null) ? counts.reduce((a, b) => a! + b!, 0) : null,
			totalUnitsSecondary: chain.length,
			isAdult: chain.some((m) => m.isAdult)
		},
		externalIds: parts.flatMap((p) => p.externalIds),
		titles: uniqueTitles(
			parts.flatMap((p) => p.titles.map((t) => ({ title: t.title, locale: t.locale ?? null })))
		),
		seasons: chain.map((m, i): FranchiseSeason => ({
			number: i + 1,
			anilistId: String(m.id),
			title: displayTitle(m),
			airDate: toDate(m.startDate),
			status: m.status ? STATUS[m.status] : null,
			episodeCount: m.episodes,
			posterUrl: m.coverImage?.large ?? null
		}))
	};
}

export type AniListClient = ProviderClient & {
	/** Upcoming episodes of several anime, by AniList id (one request). */
	schedules(ids: string[]): Promise<Map<string, { episode: number; airingAt: number }[]>>;
	/** Public lists of an AniList user; null when the profile is private or unknown. */
	userList(userName: string, type: 'anime' | 'manga'): Promise<ImportItem[] | null>;
	/** AniList media for MyAnimeList ids (50 per request); ids AniList does not know are absent. */
	byMalIds(ids: number[], type: 'anime' | 'manga'): Promise<Map<number, ProviderMedia>>;
	/**
	 * An anime found by title and year (within one), then its TV sequels in order: AniList has one
	 * entry per season where TMDB/Trakt have one show. A film is alone. Null when not found.
	 */
	animeSeasons(title: string, year: number | null, movie: boolean): Promise<ProviderMedia[] | null>;
};

const SERIES_FORMATS = ['TV', 'TV_SHORT', 'ONA'];
// Every format but music videos (a null format_in makes AniList answer 500)
const ANY_FORMATS = [...SERIES_FORMATS, 'MOVIE', 'OVA', 'SPECIAL'];
const MAX_SEASONS = 30;

export function createAniListClient(
	opts: { fetch?: Fetch; limiter?: RateLimiter } = {}
): AniListClient {
	const fetch = opts.fetch ?? globalThis.fetch;
	const limiter = opts.limiter ?? createRateLimiter(30);
	const searches = new Map<
		string,
		Promise<Record<'anime' | 'manga', { media: AniMedia[] }> | null>
	>();

	async function query<T>(gql: string, variables: Record<string, unknown>): Promise<T | null> {
		const res = await fetchJson<{
			data: T | null;
			errors?: { message: string; status?: number }[];
		}>('anilist', URL, {
			fetch,
			limiter,
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query: gql, variables })
		});
		// AniList answers 404 inside a 200/404 body with errors[].status
		if (!res || res.errors?.some((e) => e.status === 404)) return null;
		if (res.errors?.length) throw new ProviderError('anilist', 200, res.errors[0].message);
		return res.data;
	}

	const aniType = (type: MediaType) => {
		if (type === 'anime') return 'ANIME';
		if (type === 'manga') return 'MANGA';
		throw new Error(`AniList does not handle ${type}`);
	};

	return {
		types: ['anime', 'manga'],

		async search(q, type) {
			aniType(type);
			// The page searches anime and manga in two jobs: one request answers both, so the second
			// does not wait 2 s for the rate limiter
			let both = searches.get(q);
			if (!both) {
				both = query<Record<'anime' | 'manga', { media: AniMedia[] }>>(
					`query ($q: String) {
						anime: Page(perPage: 20) { media(search: $q, type: ANIME, sort: SEARCH_MATCH) { ${FIELDS} } }
						manga: Page(perPage: 20) { media(search: $q, type: MANGA, sort: SEARCH_MATCH) { ${FIELDS} } }
					}`,
					{ q }
				);
				searches.set(q, both);
				// shortcut: kept 10 s in memory, enough for the sibling job; the provider cache keeps the rest
				const forget = () => setTimeout(() => searches.delete(q), 10_000);
				both.then(forget, forget);
			}
			const data = await both;
			return (data?.[type as 'anime' | 'manga'].media ?? []).map(toSearchResult);
		},

		async trending(type) {
			const data = await query<{ Page: { media: AniMedia[] } }>(
				`query ($type: MediaType) {
					Page(perPage: 20) { media(type: $type, sort: TRENDING_DESC, isAdult: false) { ${FIELDS} } }
				}`,
				{ type: aniType(type) }
			);
			return (data?.Page.media ?? []).map(toSearchResult);
		},

		async recommendations(id, type) {
			const data = await query<{
				Media: { recommendations: { nodes: { mediaRecommendation: AniMedia | null }[] } };
			}>(
				`query ($id: Int, $type: MediaType) {
					Media(id: $id, type: $type) {
						recommendations(sort: RATING_DESC, perPage: 15) { nodes { mediaRecommendation { ${FIELDS} } } }
					}
				}`,
				{ id: Number(id), type: aniType(type) }
			);
			return (data?.Media.recommendations.nodes ?? [])
				.map((n) => n.mediaRecommendation)
				.filter((m): m is AniMedia => !!m)
				.map(toSearchResult);
		},

		async get(id, type) {
			const fields = `${DETAIL_FIELDS} relations { edges { relationType node { id format startDate { year month day } } } }`;
			const byId = new Map<number, AniMedia | null>();
			const load = async (id: number) => {
				if (!byId.has(id)) {
					const data = await query<{ Media: AniMedia | null }>(
						`query ($id: Int, $type: MediaType) { Media(id: $id, type: $type) { ${fields} } }`,
						{ id, type: aniType(type) }
					);
					byId.set(id, data?.Media ?? null);
				}
				return byId.get(id)!;
			};
			const m = await load(Number(id));
			if (!m) return null;
			const isSeries = (f: string | null | undefined) => SERIES_FORMATS.includes(f ?? '');
			if (type !== 'anime' || !isSeries(m.format)) return toProviderMedia(m);

			// Series seasons around it: back through prequels to the first, then sequels in order.
			// Several series sequels (rare): the earliest is the next season.
			const next = (s: AniMedia, relation: 'PREQUEL' | 'SEQUEL') =>
				s.relations?.edges
					.filter((e) => e.relationType === relation && isSeries(e.node.format))
					.map((e) => ({ id: e.node.id, date: toDate(e.node.startDate ?? null) ?? '9999' }))
					.sort((a, b) => a.date.localeCompare(b.date))[0]?.id;
			let root = m;
			for (const seen = new Set([m.id]); seen.size < MAX_SEASONS;) {
				const id = next(root, 'PREQUEL');
				const prequel = id && !seen.has(id) ? await load(id) : null;
				if (!prequel) break;
				seen.add(prequel.id);
				root = prequel;
			}
			const chain = [root];
			while (chain.length < MAX_SEASONS) {
				const id = next(chain.at(-1)!, 'SEQUEL');
				const sequel = id && !chain.some((s) => s.id === id) ? await load(id) : null;
				if (!sequel) break;
				chain.push(sequel);
			}
			// A side branch of the chain (a second sequel) stays a work of its own
			return chain.includes(m) ? toFranchise(chain) : toProviderMedia(m);
		},

		async schedules(ids) {
			const found = new Map<string, { episode: number; airingAt: number }[]>();
			if (!ids.length) return found;
			const data = await query<{
				Page: {
					media: {
						id: number;
						airingSchedule: { nodes: { episode: number; airingAt: number }[] };
					}[];
				};
			}>(
				`query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) {
					id airingSchedule(notYetAired: true, perPage: 50) { nodes { episode airingAt } }
				} } }`,
				{ ids: ids.map(Number) }
			);
			for (const m of data?.Page.media ?? []) found.set(String(m.id), m.airingSchedule.nodes);
			return found;
		},

		async byMalIds(ids, type) {
			const found = new Map<number, ProviderMedia>();
			for (let i = 0; i < ids.length; i += 50) {
				const data = await query<{ Page: { media: AniMedia[] } }>(
					`query ($ids: [Int], $type: MediaType) {
						Page(perPage: 50) { media(idMal_in: $ids, type: $type) { ${DETAIL_FIELDS} } }
					}`,
					{ ids: ids.slice(i, i + 50), type: aniType(type) }
				);
				for (const m of data?.Page.media ?? []) {
					if (m.idMal) found.set(m.idMal, toProviderMedia(m));
				}
			}
			return found;
		},

		async animeSeasons(title, year, movie) {
			const fields = `${DETAIL_FIELDS} relations { edges { relationType node { id format } } }`;
			const find = async (q: string, formats: string[], keep?: (r: AniMedia) => boolean) => {
				const data = await query<{ Page: { media: AniMedia[] } }>(
					`query ($q: String, $formats: [MediaFormat]) {
						Page(perPage: 10) { media(search: $q, type: ANIME, format_in: $formats, sort: SEARCH_MATCH) { ${fields} } }
					}`,
					{ q, formats }
				);
				return data?.Page.media.find(
					(r) =>
						(keep?.(r) ?? true) &&
						(year === null || (r.startDate?.year != null && Math.abs(r.startDate.year - year) <= 1))
				);
			};
			// AniList's search misses some English titles: retry without accents ("Shippūden"),
			// without "the Movie", then the part before ":" or "!" ("Food Wars! Shokugeki no Soma"),
			// and last in any format (OVAs, a "film" AniList lists as TV). Only on failure.
			const plain = title.normalize('NFD').replace(/\p{M}/gu, '');
			const noMovie = plain.replace(/[\s:-]*\bthe movie\b/i, '').trim();
			const queries = [...new Set([title, plain, noMovie])];
			const prefix = noMovie.split(/[:!]/)[0].trim();
			const norm = (s: string) =>
				s
					.normalize('NFD')
					.replace(/\p{M}/gu, '')
					.toLowerCase()
					.replace(/[^\p{L}\p{N}]+/gu, ' ')
					.trim();
			// A franchise name ("Fate/Grand Order") finds other works: only an entry of that exact name
			const named = (r: AniMedia) =>
				[r.title.english, r.title.romaji, ...(r.synonyms ?? [])].some(
					(t) => !!t && norm(t) === norm(prefix)
				);
			let m: AniMedia | undefined;
			for (const formats of [movie ? ['MOVIE'] : SERIES_FORMATS, ANY_FORMATS]) {
				for (const q of queries) m ??= await find(q, formats);
				if (!m && prefix && !queries.includes(prefix)) m = await find(prefix, formats, named);
			}
			const seasons: ProviderMedia[] = [];
			while (m && seasons.length < MAX_SEASONS) {
				seasons.push(toProviderMedia(m));
				if (movie || !SERIES_FORMATS.includes(m.format ?? '')) break; // films, OVAs: one entry
				const next = m.relations?.edges.find(
					(e) => e.relationType === 'SEQUEL' && SERIES_FORMATS.includes(e.node.format ?? '')
				);
				if (!next) break;
				const sequel = await query<{ Media: AniMedia | null }>(
					`query ($id: Int) { Media(id: $id, type: ANIME) { ${fields} } }`,
					{ id: next.node.id }
				);
				m = sequel?.Media ?? undefined;
			}
			return seasons.length ? seasons : null;
		},

		async userList(userName, type) {
			const items: ImportItem[] = [];
			for (let chunk = 1; ; chunk++) {
				const data = await query<{ MediaListCollection: ListCollection | null }>(
					`query ($user: String, $type: MediaType, $chunk: Int) {
						MediaListCollection(userName: $user, type: $type, chunk: $chunk, perChunk: 500) {
							hasNextChunk
							lists { isCustomList entries {
								status score(format: POINT_100) progress progressVolumes repeat notes
								startedAt { year month day } completedAt { year month day }
								media { ${DETAIL_FIELDS} }
							} }
						}
					}`,
					{ user: userName, type: aniType(type), chunk }
				);
				const collection = data?.MediaListCollection;
				if (!collection) return chunk === 1 ? null : items;
				// Custom lists repeat entries already in the status lists
				for (const list of collection.lists.filter((l) => !l.isCustomList)) {
					for (const e of list.entries) {
						items.push({
							label: displayTitle(e.media),
							type,
							media: toProviderMedia(e.media),
							entry: {
								status: LIST_STATUS[e.status],
								progress: e.progress ?? 0,
								progressSecondary: e.progressVolumes ?? 0,
								score: e.score ? Math.round(e.score) : null, // 0 means "not rated"
								startedOn: toDate(e.startedAt),
								completedOn: toDate(e.completedAt),
								repeatCount: e.repeat ?? 0,
								review: null,
								notes: e.notes || null
							}
						});
					}
				}
				if (!collection.hasNextChunk) return items;
			}
		},

		// AniList only knows air dates through its schedule: list the upcoming episodes.
		async episodes(id, type) {
			if (type !== 'anime') return null;
			const data = await query<{
				Media: {
					duration: number | null;
					airingSchedule: { nodes: { episode: number; airingAt: number }[] };
				} | null;
			}>(
				`query ($id: Int) { Media(id: $id, type: ANIME) {
					duration airingSchedule(notYetAired: true, perPage: 50) { nodes { episode airingAt } }
				} }`,
				{ id: Number(id) }
			);
			const m = data?.Media;
			if (!m) return null;
			return {
				upcomingOnly: true,
				seasons: [],
				episodes: m.airingSchedule.nodes.map((n) => ({
					seasonNumber: null,
					number: n.episode,
					absoluteNumber: n.episode,
					title: null,
					airDate: new Date(n.airingAt * 1000),
					runtimeMinutes: m.duration
				}))
			};
		}
	};
}
