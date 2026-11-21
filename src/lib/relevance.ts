const normalize = (s: string) =>
	s
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();

/**
 * How well a title answers a search: 3 exact, 2 starts with the query, 1 contains it as
 * whole words, 0 otherwise. Accent, case and punctuation insensitive.
 */
export function relevance(query: string, title: string) {
	const q = normalize(query);
	const t = normalize(title);
	if (!q) return 0;
	if (t === q) return 3;
	if (t.startsWith(`${q} `)) return 2;
	return ` ${t} `.includes(` ${q} `) ? 1 : 0;
}

/** Titles of a later season, part or volume ("Season 2", "2nd Season", "Part 2", "II"). */
const SEQUEL =
	/\b(season|saison|part|partie|cour|tome|vol|volume) \d+\b|\b\d+(st|nd|rd|th) season\b| (ii|iii|iv)$/;
export const isSequel = (title: string) => SEQUEL.test(normalize(title));

/**
 * Sorted copy, most relevant first, then works before their sequels; other ties keep their
 * order (providers rank them already).
 */
export const byRelevance = <T extends { title: string }>(query: string, items: T[]) =>
	items
		.map((item, i) => ({
			item,
			i,
			r: relevance(query, item.title),
			sequel: +isSequel(item.title)
		}))
		.sort((a, b) => b.r - a.r || a.sequel - b.sequel || a.i - b.i)
		.map((x) => x.item);
