import type { media, mediaExternalIds, mediaTitles } from '../db/schema';
import type { BookLookup } from '../imports/types';

export type MediaType = (typeof media.$inferInsert)['type'];
export type Provider = (typeof mediaExternalIds.$inferInsert)['provider'];

/** Lightweight row shown in search results, before the media is imported. */
export type SearchResult = {
	provider: Provider;
	externalId: string;
	type: MediaType;
	title: string;
	originalTitle: string | null;
	year: number | null;
	posterUrl: string | null;
	isAdult: boolean;
	/** How many users rated it, when the provider says (TMDB): tells homonyms apart. */
	votes?: number;
};

export type SearchOptions = { year?: number; english?: boolean };

/** Everything needed to insert or refresh a media in the catalogue. */
export type ProviderMedia = {
	media: Omit<typeof media.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>;
	/** The first one is the primary id (source of truth for syncs). */
	externalIds: { provider: Provider; externalId: string }[];
	titles: Omit<typeof mediaTitles.$inferInsert, 'id' | 'mediaId'>[];
};

/** Seasons and episodes of a TV show or anime, for episode tracking and the calendar. */
export type ProviderEpisodes = {
	seasons: {
		number: number; // 0 = specials
		title: string | null;
		airDate: string | null;
		episodeCount: number | null;
		posterUrl: string | null;
	}[];
	episodes: {
		seasonNumber: number | null; // null for anime (one AniList entry per season)
		number: number;
		absoluteNumber: number | null;
		title: string | null;
		airDate: Date | null;
		runtimeMinutes: number | null;
	}[];
	/** True when only upcoming episodes are listed (AniList airing schedule). */
	upcomingOnly: boolean;
};

export interface ProviderClient {
	readonly types: readonly MediaType[];
	/**
	 * `year` narrows the search and `english` gives English titles, where the provider supports
	 * it (TMDB): imports from English-titled sources match on them.
	 */
	search(query: string, type: MediaType, opts?: SearchOptions): Promise<SearchResult[]>;
	/** Null when the provider does not know this id. */
	get(externalId: string, type: MediaType): Promise<ProviderMedia | null>;
	/** Only for types with episodes (tv, anime). Null when the provider does not know this id. */
	episodes?(externalId: string, type: MediaType): Promise<ProviderEpisodes | null>;
	/** What is popular this week. */
	trending?(type: MediaType): Promise<SearchResult[]>;
	/** Works the provider's users liked along with this one. */
	recommendations?(externalId: string, type: MediaType): Promise<SearchResult[]>;
	/** Books only: finds a book from an import row (ISBN first, then title and author). */
	lookup?(book: BookLookup): Promise<ProviderMedia | null>;
}

export const yearOf = (date: string | null | undefined) =>
	date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null;

/** Removes HTML tags and entities left in provider descriptions. */
export const plainText = (html: string | null | undefined) =>
	html
		? html
				.replace(/<br\s*\/?>/gi, '\n')
				.replace(/<[^>]+>/g, '')
				.replace(/&amp;/g, '&')
				.replace(/&quot;/g, '"')
				.replace(/&#039;/g, "'")
				.replace(/\n{3,}/g, '\n\n')
				.trim() || null
		: null;

/** Unique titles, the first occurrence winning (keeps the most specific locale). */
export function uniqueTitles(
	titles: { title: string | null | undefined; locale: string | null }[]
) {
	const seen = new Set<string>();
	const out: ProviderMedia['titles'] = [];
	for (const { title, locale } of titles) {
		const t = title?.trim();
		if (t && !seen.has(t)) {
			seen.add(t);
			out.push({ title: t, locale });
		}
	}
	return out;
}
