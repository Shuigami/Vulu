// AniList GraphQL API (anime, manga). Public queries need no key.
// https://docs.anilist.co — rate limit ~90 requests/minute.
import type { ImportItem } from '../imports/types';
import { createRateLimiter, fetchJson, ProviderError, type Fetch, type RateLimiter } from './http';
import {
	plainText,
	uniqueTitles,
	yearOf,
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

export type AniListClient = ProviderClient & {
	/** Public lists of an AniList user; null when the profile is private or unknown. */
	userList(userName: string, type: 'anime' | 'manga'): Promise<ImportItem[] | null>;
	/** AniList media for MyAnimeList ids (50 per request); ids AniList does not know are absent. */
	byMalIds(ids: number[], type: 'anime' | 'manga'): Promise<Map<number, ProviderMedia>>;
};

export function createAniListClient(
	opts: { fetch?: Fetch; limiter?: RateLimiter } = {}
): AniListClient {
	const fetch = opts.fetch ?? globalThis.fetch;
	const limiter = opts.limiter ?? createRateLimiter(85);

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
			const data = await query<{ Page: { media: AniMedia[] } }>(
				`query ($q: String, $type: MediaType) {
					Page(perPage: 20) { media(search: $q, type: $type, sort: SEARCH_MATCH) { ${FIELDS} } }
				}`,
				{ q, type: aniType(type) }
			);
			return (data?.Page.media ?? []).map((m): SearchResult => ({
				provider: 'anilist',
				externalId: String(m.id),
				type,
				title: displayTitle(m),
				originalTitle: m.title.native,
				year: yearOf(toDate(m.startDate)),
				posterUrl: m.coverImage?.large ?? null,
				isAdult: m.isAdult
			}));
		},

		async get(id, type) {
			const data = await query<{ Media: AniMedia }>(
				`query ($id: Int, $type: MediaType) { Media(id: $id, type: $type) { ${DETAIL_FIELDS} } }`,
				{ id: Number(id), type: aniType(type) }
			);
			const m = data?.Media;
			if (!m) return null;
			return toProviderMedia(m);
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
