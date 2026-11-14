// Trakt anime -> AniList, the source of truth for anime: otherwise they would land in "Séries"
// (TMDB) and be duplicated by an AniList or MyAnimeList import.
import type { Db } from '../db';
import type { AniListClient } from '../providers/anilist';
import { cached, DAY } from '../providers/cache';
import type { TraktItem } from '../providers/trakt';
import type { ImportItem } from './types';

/**
 * Replaces each anime row with its AniList entries. A show's episodes seen (Trakt counts them
 * across TMDB seasons) fill AniList's seasons in order, so "47 episodes of Jujutsu Kaisen" gives
 * season 1 (24) and season 2 (23). Rows AniList does not know stay, unmatched, as anime.
 */
export async function resolveTraktAnime(
	db: Db,
	anilist: AniListClient,
	items: TraktItem[]
): Promise<ImportItem[]> {
	const out: ImportItem[] = [];
	for (const { anime, ...item } of items) {
		if (!anime) {
			out.push(item);
			continue;
		}
		const movie = item.type === 'movie';
		const key = `anilist:seasons:${movie ? 'movie' : 'tv'}:${anime.year}:${anime.title.toLowerCase()}`;
		let seasons = null;
		try {
			seasons = await cached(db, key, 7 * DAY, () =>
				anilist.animeSeasons(anime.title, anime.year, movie)
			);
		} catch (err) {
			console.error(`[import] AniList lookup for ${item.label}`, err); // left unmatched
		}
		const row = { ...item, type: 'anime' as const, ref: undefined };
		if (!seasons) {
			out.push(row);
			continue;
		}
		let left = item.entry.progress;
		for (const [i, media] of seasons.entries()) {
			if (i > 0 && left <= 0) break; // later seasons not started
			const total = media.media.totalUnits;
			const progress = movie ? 0 : total ? Math.min(left, total) : left;
			left -= progress;
			out.push({ ...row, label: media.media.title, media, entry: { ...item.entry, progress } });
		}
	}
	return out;
}
