// Series progress shown season by season ("S3 · Ép. 5/12") rather than across the whole show
// ("17/49"). Progress stays one absolute counter in the database: this only maps it onto seasons.
// Shared by the server (library, home) and the media page.

/** A numbered season and the absolute numbers of its first and last episodes. */
export type SeasonRange = { season: number; first: number; last: number };

export type SeasonPosition = {
	season: number;
	/** Episodes of that season seen, so the last one seen when it is not 0. */
	seen: number;
	count: number;
};

/**
 * Where `progress` stands: the season holding the last episode seen (the first season before
 * anything is seen). Null for a work with fewer than two seasons, or a progress past the known
 * episodes: those keep the absolute count.
 */
export function seasonPosition(
	ranges: readonly SeasonRange[],
	progress: number
): SeasonPosition | null {
	const at = seasonAt(ranges, Math.max(1, progress), progress);
	return at && { season: at.season, seen: at.seen, count: at.count };
}

/**
 * The season holding episode `absolute`, with what `progress` covers of it (0 to all of it).
 * Null under the same conditions as `seasonPosition`.
 */
export function seasonAt(
	ranges: readonly SeasonRange[],
	absolute: number,
	progress: number
): (SeasonPosition & { first: number }) | null {
	if (ranges.length < 2) return null;
	const r = ranges.find((s) => s.first <= absolute && absolute <= s.last);
	if (!r) return null;
	const count = r.last - r.first + 1;
	return {
		season: r.season,
		first: r.first,
		seen: Math.min(count, Math.max(0, progress - r.first + 1)),
		count
	};
}

/** "S3 · Ép. 5/12", or "S3 · Ép. 5" without the season's count. */
export const seasonLabel = (p: SeasonPosition, withCount = true) =>
	`S${p.season} · Ép. ${p.seen}${withCount ? `/${p.count}` : ''}`;

/** Ranges of the media page's season list (specials and the anime group without season left out). */
export function rangesOf(
	seasons: readonly { number: number | null; episodes: readonly { absolute: number | null }[] }[]
): SeasonRange[] {
	const ranges: SeasonRange[] = [];
	for (const s of seasons) {
		if (!s.number) continue;
		const numbers = s.episodes.flatMap((e) => (e.absolute === null ? [] : [e.absolute]));
		if (numbers.length)
			ranges.push({ season: s.number, first: Math.min(...numbers), last: Math.max(...numbers) });
	}
	return ranges.sort((a, b) => a.first - b.first);
}
