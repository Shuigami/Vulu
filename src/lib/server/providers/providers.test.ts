import { describe, expect, it } from 'vitest';
import { createAniListClient } from './anilist';
import { createRateLimiter, fetchJson, ProviderError, type Fetch } from './http';
import { createOpenLibraryClient } from './openlibrary';
import { createTmdbClient } from './tmdb';

const noWait = async () => {};
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers });

/** Fake fetch answering from a list of [url substring, response] pairs, recording calls. */
function fakeFetch(routes: [string, () => Response][]) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fetch: Fetch = async (input, init) => {
		const url = String(input);
		calls.push({ url, init });
		const route = routes.find(([part]) => url.includes(part));
		if (!route) throw new Error(`Unexpected request ${url}`);
		return route[1]();
	};
	return { fetch, calls };
}

describe('http', () => {
	it('spaces requests according to the rate limit', async () => {
		const wait = createRateLimiter(1200); // one every 50 ms
		const start = Date.now();
		await Promise.all([wait(), wait(), wait()]);
		expect(Date.now() - start).toBeGreaterThanOrEqual(95);
	});

	it('retries after a 429 and returns null on 404', async () => {
		let attempts = 0;
		const { fetch } = fakeFetch([
			[
				'/limited',
				() => (++attempts === 1 ? json({}, 429, { 'Retry-After': '0.01' }) : json({ ok: 1 }))
			],
			['/missing', () => json({}, 404)],
			['/broken', () => json({}, 400)]
		]);
		const opts = { fetch, limiter: noWait };
		expect(await fetchJson('test', 'https://x/limited', opts)).toEqual({ ok: 1 });
		expect(attempts).toBe(2);
		expect(await fetchJson('test', 'https://x/missing', opts)).toBeNull();
		await expect(fetchJson('test', 'https://x/broken?api_key=secret', opts)).rejects.toThrow(
			new ProviderError('test', 400, 'HTTP 400 for https://x/broken?api_key=***')
		);
	});
});

describe('AniList client', () => {
	const frieren = {
		id: 154587,
		idMal: 52991,
		type: 'ANIME',
		format: 'TV',
		status: 'FINISHED',
		title: {
			romaji: 'Sousou no Frieren',
			english: 'Frieren: Beyond Journey’s End',
			native: '葬送のフリーレン'
		},
		synonyms: ['Sōsō no Furīren', 'Sousou no Frieren'],
		description: 'An elf mage<br><br>after the <i>journey</i>.',
		startDate: { year: 2023, month: 9, day: 29 },
		endDate: { year: 2024, month: 3, day: 22 },
		episodes: 28,
		duration: 24,
		chapters: null,
		volumes: null,
		coverImage: { extraLarge: 'https://img/xl.jpg', large: 'https://img/l.jpg' },
		bannerImage: null,
		genres: ['Adventure', 'Fantasy'],
		isAdult: false,
		studios: { nodes: [{ name: 'Madhouse' }] }
	};

	it('maps a media to the catalogue shape', async () => {
		const { fetch, calls } = fakeFetch([['anilist', () => json({ data: { Media: frieren } })]]);
		const client = createAniListClient({ fetch, limiter: noWait });
		const result = await client.get('154587', 'anime');

		expect(JSON.parse(String(calls[0].init?.body)).variables).toEqual({
			id: 154587,
			type: 'ANIME'
		});
		expect(result?.media).toMatchObject({
			type: 'anime',
			title: 'Frieren: Beyond Journey’s End',
			originalTitle: '葬送のフリーレン',
			overview: 'An elf mage\n\nafter the journey.',
			status: 'finished',
			startDate: '2023-09-29',
			totalUnits: 28,
			runtimeMinutes: 24,
			posterUrl: 'https://img/xl.jpg',
			extra: { format: 'TV', genres: ['Adventure', 'Fantasy'], studios: ['Madhouse'] }
		});
		expect(result?.externalIds).toEqual([
			{ provider: 'anilist', externalId: '154587' },
			{ provider: 'mal', externalId: '52991' }
		]);
		// Duplicates removed, accented romaji kept for the fuzzy search
		expect(result?.titles.map((t) => t.title)).toEqual([
			'Frieren: Beyond Journey’s End',
			'Sousou no Frieren',
			'葬送のフリーレン',
			'Sōsō no Furīren'
		]);
	});

	it('returns null for an unknown id', async () => {
		const { fetch } = fakeFetch([
			[
				'anilist',
				() => json({ data: { Media: null }, errors: [{ message: 'Not Found.', status: 404 }] }, 404)
			]
		]);
		expect(await createAniListClient({ fetch, limiter: noWait }).get('1', 'anime')).toBeNull();
	});
});

describe('Open Library client', () => {
	it('follows work redirects and reads authors from the search index', async () => {
		const { fetch, calls } = fakeFetch([
			[
				'/works/OL893415W.json',
				() =>
					json({
						key: '/works/OL893415W',
						type: { key: '/type/redirect' },
						location: '/works/OL893414W'
					})
			],
			[
				'/works/OL893414W.json',
				() =>
					json({
						key: '/works/OL893414W',
						type: { key: '/type/work' },
						title: 'Dune',
						description: { type: '/type/text', value: 'Arrakis.' },
						covers: [11481354],
						subjects: ['Science fiction']
					})
			],
			[
				'/search.json',
				() =>
					json({
						docs: [
							{
								key: '/works/OL893414W',
								title: 'Dune',
								author_name: ['Frank Herbert'],
								first_publish_year: 1965,
								number_of_pages_median: 608
							}
						]
					})
			]
		]);
		const result = await createOpenLibraryClient({ fetch, limiter: noWait }).get(
			'OL893415W',
			'book'
		);

		expect(calls.at(-1)?.url).toContain('q=key%3A%2Fworks%2FOL893414W');
		expect((calls[0].init?.headers as Record<string, string>)['User-Agent']).toContain(
			'github.com/Shuigami/Vulu'
		);
		expect(result?.externalIds).toEqual([{ provider: 'openlibrary', externalId: 'OL893414W' }]);
		expect(result?.media).toMatchObject({
			type: 'book',
			title: 'Dune',
			overview: 'Arrakis.',
			startDate: '1965-01-01',
			totalUnits: 608,
			posterUrl: 'https://covers.openlibrary.org/b/id/11481354-L.jpg',
			extra: { authors: ['Frank Herbert'] }
		});
	});
});

describe('TMDB client', () => {
	const severance = {
		id: 95396,
		name: 'Severance',
		original_name: 'Severance',
		first_air_date: '2022-02-17',
		last_air_date: '2025-03-20',
		status: 'Returning Series',
		overview: 'Mark dirige une équipe.',
		poster_path: '/poster.jpg',
		backdrop_path: null,
		episode_run_time: [],
		number_of_episodes: 19,
		number_of_seasons: 2,
		genres: [{ id: 18, name: 'Drame' }],
		original_language: 'en',
		external_ids: { imdb_id: 'tt11280740', tvdb_id: 371980 },
		alternative_titles: { results: [{ title: 'Dissociés', iso_3166_1: 'FR' }] }
	};

	it('sends a v3 key as api_key and maps a TV show', async () => {
		const { fetch, calls } = fakeFetch([['/tv/95396', () => json(severance)]]);
		const result = await createTmdbClient({ apiKey: 'v3key', fetch, limiter: noWait }).get(
			'95396',
			'tv'
		);

		const url = new URL(calls[0].url);
		expect(url.searchParams.get('api_key')).toBe('v3key');
		expect(url.searchParams.get('language')).toBe('fr-FR');
		expect(result?.media).toMatchObject({
			type: 'tv',
			title: 'Severance',
			originalTitle: null,
			status: 'releasing',
			startDate: '2022-02-17',
			endDate: null,
			totalUnits: 19,
			totalUnitsSecondary: 2,
			posterUrl: 'https://image.tmdb.org/t/p/w780/poster.jpg'
		});
		expect(result?.externalIds.map((i) => i.provider)).toEqual(['tmdb', 'imdb', 'tvdb']);
		expect(result?.titles.map((t) => t.title)).toEqual(['Severance', 'Dissociés']);
	});

	it('leaves Japanese animated series to AniList', async () => {
		const { fetch } = fakeFetch([
			[
				'/search/tv',
				() =>
					json({
						results: [
							{
								id: 1,
								name: 'Frieren',
								poster_path: null,
								genre_ids: [16, 10759],
								origin_country: ['JP']
							},
							{ id: 2, name: 'Arcane', poster_path: null, genre_ids: [16], origin_country: ['US'] }
						]
					})
			]
		]);
		const results = await createTmdbClient({ apiKey: 'k', fetch, limiter: noWait }).search(
			'x',
			'tv'
		);
		expect(results.map((r) => r.title)).toEqual(['Arcane']);
	});

	it('sends a v4 token as a bearer header', async () => {
		const { fetch, calls } = fakeFetch([['/search/movie', () => json({ results: [] })]]);
		await createTmdbClient({ apiKey: 'eyJtoken', fetch, limiter: noWait }).search('dune', 'movie');
		expect(calls[0].url).not.toContain('api_key');
		expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe(
			'Bearer eyJtoken'
		);
	});
});

describe('episodes', () => {
	it('reads TMDB seasons in one appended request, with absolute numbers outside specials', async () => {
		const { fetch, calls } = fakeFetch([
			[
				'append_to_response=season',
				() =>
					json({
						'season/0': {
							episodes: [
								{ episode_number: 1, name: 'Spécial', air_date: '2021-12-15', runtime: 10 }
							]
						},
						'season/1': {
							episodes: [
								{ episode_number: 1, name: 'Bonjour', air_date: '2022-02-17', runtime: 57 },
								{ episode_number: 2, name: '', air_date: null, runtime: null }
							]
						}
					})
			],
			[
				'/tv/95396',
				() =>
					json({
						seasons: [
							{
								season_number: 1,
								name: 'Saison 1',
								air_date: '2022-02-17',
								episode_count: 2,
								poster_path: '/s1.jpg'
							},
							{
								season_number: 0,
								name: 'Épisodes spéciaux',
								air_date: null,
								episode_count: 1,
								poster_path: null
							}
						]
					})
			]
		]);
		const result = await createTmdbClient({ apiKey: 'k', fetch, limiter: noWait }).episodes!(
			'95396',
			'tv'
		);

		expect(new URL(calls[1].url).searchParams.get('append_to_response')).toBe('season/0,season/1');
		expect(result?.seasons.map((s) => s.number)).toEqual([0, 1]);
		expect(result?.episodes).toEqual([
			{
				seasonNumber: 0,
				number: 1,
				absoluteNumber: null,
				title: 'Spécial',
				airDate: new Date('2021-12-15T00:00:00Z'),
				runtimeMinutes: 10
			},
			{
				seasonNumber: 1,
				number: 1,
				absoluteNumber: 1,
				title: 'Bonjour',
				airDate: new Date('2022-02-17T00:00:00Z'),
				runtimeMinutes: 57
			},
			{
				seasonNumber: 1,
				number: 2,
				absoluteNumber: 2,
				title: null,
				airDate: null,
				runtimeMinutes: null
			}
		]);
		expect(result?.upcomingOnly).toBe(false);
	});

	it('reads the AniList airing schedule as upcoming episodes', async () => {
		const { fetch } = fakeFetch([
			[
				'anilist',
				() =>
					json({
						data: {
							Media: {
								duration: 24,
								airingSchedule: { nodes: [{ episode: 1181, airingAt: 1798985760 }] }
							}
						}
					})
			]
		]);
		const result = await createAniListClient({ fetch, limiter: noWait }).episodes!('21', 'anime');
		expect(result).toEqual({
			upcomingOnly: true,
			seasons: [],
			episodes: [
				{
					seasonNumber: null,
					number: 1181,
					absoluteNumber: 1181,
					title: null,
					airDate: new Date(1798985760 * 1000),
					runtimeMinutes: 24
				}
			]
		});
	});
});

describe('trending and recommendations', () => {
	it('TMDB: trending and recommendations without Japanese animation', async () => {
		const items = [
			{ id: 1, name: 'Severance', first_air_date: '2022-02-18', poster_path: '/s.jpg' },
			{ id: 2, name: 'Frieren', origin_country: ['JP'], genre_ids: [16], poster_path: null }
		];
		const { fetch, calls } = fakeFetch([['api.themoviedb.org', () => json({ results: items })]]);
		const tmdb = createTmdbClient({ apiKey: 'k', fetch, limiter: noWait });
		const trending = await tmdb.trending!('tv');
		expect(trending).toEqual([
			{
				provider: 'tmdb',
				externalId: '1',
				type: 'tv',
				title: 'Severance',
				originalTitle: null,
				year: 2022,
				posterUrl: 'https://image.tmdb.org/t/p/w342/s.jpg',
				isAdult: false
			}
		]);
		expect(await tmdb.recommendations!('95396', 'tv')).toHaveLength(1);
		expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
			'/3/trending/tv/week',
			'/3/tv/95396/recommendations'
		]);
	});

	it('AniList: recommendations skip removed media', async () => {
		const m = {
			id: 5114,
			type: 'ANIME',
			title: { romaji: 'Hagane', english: 'Fullmetal Alchemist', native: null },
			startDate: { year: 2009 },
			coverImage: { large: 'https://img/fma.jpg' },
			isAdult: false
		};
		const { fetch } = fakeFetch([
			[
				'anilist',
				() =>
					json({
						data: {
							Media: {
								recommendations: {
									nodes: [{ mediaRecommendation: null }, { mediaRecommendation: m }]
								}
							}
						}
					})
			]
		]);
		const client = createAniListClient({ fetch, limiter: noWait });
		expect(await client.recommendations!('154587', 'anime')).toMatchObject([
			{ provider: 'anilist', externalId: '5114', type: 'anime', title: 'Fullmetal Alchemist' }
		]);
	});

	it('Open Library: weekly trending works', async () => {
		const { fetch } = fakeFetch([
			[
				'/trending/weekly.json',
				() =>
					json({
						works: [
							{ key: '/works/OL893414W', title: 'Dune', first_publish_year: 1965, cover_i: 7 }
						]
					})
			]
		]);
		const client = createOpenLibraryClient({ fetch, limiter: noWait });
		expect(await client.trending!('book')).toMatchObject([
			{
				externalId: 'OL893414W',
				title: 'Dune',
				year: 1965,
				posterUrl: expect.stringContaining('7-M')
			}
		]);
	});
});
