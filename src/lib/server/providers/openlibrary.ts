// Open Library API (books). No key; requests must carry an identifying User-Agent.
// https://openlibrary.org/developers/api — kept to 1 request/second.
import { createRateLimiter, fetchJson, type Fetch, type RateLimiter } from './http';
import { plainText, uniqueTitles, type ProviderClient, type SearchResult } from './types';

const BASE = 'https://openlibrary.org';
const cover = (id: number | null | undefined, size: 'M' | 'L') =>
	id && id > 0 ? `https://covers.openlibrary.org/b/id/${id}-${size}.jpg` : null;

type SearchDoc = {
	key: string; // '/works/OL893414W'
	title: string;
	author_name?: string[];
	first_publish_year?: number;
	cover_i?: number;
	number_of_pages_median?: number;
	language?: string[];
};
type Work = {
	key: string;
	type: { key: string };
	location?: string; // set on '/type/redirect'
	title?: string;
	description?: string | { value: string };
	covers?: number[];
	subjects?: string[];
};

const SEARCH_FIELDS = 'key,title,author_name,first_publish_year,cover_i,number_of_pages_median';
const workId = (key: string) => key.replace('/works/', '');
const toResult = (d: SearchDoc): SearchResult => ({
	provider: 'openlibrary',
	externalId: workId(d.key),
	type: 'book',
	title: d.title,
	originalTitle: null,
	year: d.first_publish_year ?? null,
	posterUrl: cover(d.cover_i, 'M'),
	isAdult: false
});

export function createOpenLibraryClient(
	opts: { fetch?: Fetch; limiter?: RateLimiter } = {}
): ProviderClient {
	const fetch = opts.fetch ?? globalThis.fetch;
	const limiter = opts.limiter ?? createRateLimiter(60);
	const get = <T>(path: string) =>
		fetchJson<T>('openlibrary', `${BASE}${path}`, { fetch, limiter });

	async function searchDocs(q: string, limit: number) {
		const params = new URLSearchParams({ q, fields: SEARCH_FIELDS, limit: String(limit) });
		return (await get<{ docs: SearchDoc[] }>(`/search.json?${params}`))?.docs ?? [];
	}

	return {
		types: ['book'],

		// One search request per attempt: the search index carries everything a book needs.
		async lookup({ isbn13, isbn, title, author }) {
			const words = (s: string) => s.replace(/[^\p{L}\p{N}\s']/gu, ' ').trim();
			const attempts = [
				isbn13 && `isbn:${isbn13}`,
				isbn && `isbn:${isbn}`,
				words(title) &&
					`title:(${words(title)})${author && words(author) ? ` author:(${words(author)})` : ''}`
			].filter((q): q is string => !!q);
			for (const q of attempts) {
				const [doc] = await searchDocs(q, 1);
				if (doc) {
					return {
						media: {
							type: 'book',
							title: doc.title,
							status: 'finished',
							startDate: doc.first_publish_year ? `${doc.first_publish_year}-01-01` : null,
							posterUrl: cover(doc.cover_i, 'L'),
							totalUnits: doc.number_of_pages_median ?? null,
							extra: { authors: doc.author_name ?? [] }
						},
						externalIds: [{ provider: 'openlibrary', externalId: workId(doc.key) }],
						titles: uniqueTitles([{ title: doc.title, locale: null }])
					};
				}
			}
			return null;
		},

		async search(q) {
			return (await searchDocs(q, 20)).map(toResult);
		},

		async trending() {
			const res = await get<{ works: SearchDoc[] }>('/trending/weekly.json?limit=20');
			return (res?.works ?? []).map(toResult);
		},

		async get(id) {
			let work = await get<Work>(`/works/${encodeURIComponent(id)}.json`);
			// Merged works are redirects to the surviving one
			if (work?.type.key === '/type/redirect' && work.location) {
				work = await get<Work>(`${work.location}.json`);
			}
			if (!work?.title) return null;
			const realId = workId(work.key);
			// Authors and page count are only exposed by the search index
			const [doc] = await searchDocs(`key:/works/${realId}`, 1);

			return {
				media: {
					type: 'book',
					title: work.title,
					originalTitle: null,
					overview: plainText(
						typeof work.description === 'string' ? work.description : work.description?.value
					),
					status: 'finished',
					startDate: doc?.first_publish_year ? `${doc.first_publish_year}-01-01` : null,
					// Deleted covers are listed as -1
					posterUrl: cover(work.covers?.find((c) => c > 0) ?? doc?.cover_i, 'L'),
					totalUnits: doc?.number_of_pages_median ?? null,
					extra: {
						authors: doc?.author_name ?? [],
						subjects: (work.subjects ?? []).slice(0, 20)
					}
				},
				externalIds: [{ provider: 'openlibrary', externalId: realId }],
				titles: uniqueTitles([{ title: work.title, locale: null }])
			};
		}
	};
}
