// Anime found by title on AniList, the source of truth for anime, for imports from sources keyed
// on TMDB (Trakt, Letterboxd): otherwise they land in "Films" or "Séries" and an AniList or
// MyAnimeList import duplicates them.
import type { Db } from '../db';
import type { AniListClient } from '../providers/anilist';
import { cached, DAY } from '../providers/cache';
import type { ProviderMedia } from '../providers/types';

/**
 * The AniList entries of an anime (a film, or a show's seasons in order), trying each title in
 * turn (English, then original). Null when none is found or AniList fails (the row stays unmatched).
 */
export async function findAnime(
	db: Db,
	anilist: AniListClient,
	titles: (string | null)[],
	year: number | null,
	movie: boolean
): Promise<ProviderMedia[] | null> {
	for (const title of new Set(titles)) {
		if (!title) continue;
		const key = `anilist:seasons:${movie ? 'movie' : 'tv'}:${year}:${title.toLowerCase()}`;
		try {
			const seasons = await cached(db, key, 7 * DAY, () =>
				anilist.animeSeasons(title, year, movie)
			);
			if (seasons) return seasons;
		} catch (err) {
			console.error(`[import] AniList lookup for ${title}`, err);
		}
	}
	return null;
}
