import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { Providers } from '../catalogue';
import { createDb } from '../db';
import { libraryEntries, media, users } from '../db/schema';
import type { AniListClient } from '../providers/anilist';
import type { Fetch } from '../providers/http';
import { createTraktClient } from '../providers/trakt';
import type { ProviderMedia } from '../providers/types';
import { parseMal, readMalFile, resolveMal } from './mal';
import { runImport } from './run';

const noWait = async () => {};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const malXml = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
	<myinfo><user_name>someone</user_name><user_export_type>1</user_export_type></myinfo>
	<anime>
		<series_animedb_id>52991</series_animedb_id>
		<series_title><![CDATA[Sousou no Frieren]]></series_title>
		<my_watched_episodes>28</my_watched_episodes>
		<my_start_date>2023-09-29</my_start_date>
		<my_finish_date>2024-03-00</my_finish_date>
		<my_score>10</my_score>
		<my_status>Completed</my_status>
		<my_times_watched>1</my_times_watched>
		<my_comments><![CDATA[Chef-d'œuvre <3]]></my_comments>
	</anime>
	<anime>
		<series_animedb_id>21</series_animedb_id>
		<series_title><![CDATA[One Piece]]></series_title>
		<my_watched_episodes>0</my_watched_episodes>
		<my_start_date>0000-00-00</my_start_date>
		<my_finish_date>0000-00-00</my_finish_date>
		<my_score>0</my_score>
		<my_status>Plan to Watch</my_status>
		<my_times_watched>0</my_times_watched>
		<my_comments><![CDATA[]]></my_comments>
	</anime>
	<manga>
		<manga_mangadb_id>2</manga_mangadb_id>
		<manga_title><![CDATA[Berserk]]></manga_title>
		<my_read_volumes>41</my_read_volumes>
		<my_read_chapters>364</my_read_chapters>
		<my_score>9</my_score>
		<my_status>On-Hold</my_status>
		<my_start_date>0000-00-00</my_start_date>
		<my_finish_date>0000-00-00</my_finish_date>
		<my_times_read>0</my_times_read>
	</manga>
</myanimelist>`;

describe('MyAnimeList export', () => {
	it('reads anime and manga rows', () => {
		const [frieren, onePiece, berserk] = parseMal(malXml);
		expect(frieren).toMatchObject({
			label: 'Sousou no Frieren',
			type: 'anime',
			malId: 52991,
			entry: {
				status: 'completed',
				progress: 28,
				score: 100,
				startedOn: '2023-09-29',
				completedOn: '2024-03-01',
				repeatCount: 1,
				notes: "Chef-d'œuvre <3"
			}
		});
		expect(onePiece.entry).toMatchObject({
			status: 'planned',
			score: null,
			startedOn: null,
			notes: null
		});
		expect(berserk).toMatchObject({
			type: 'manga',
			malId: 2,
			entry: { status: 'paused', progress: 364, progressSecondary: 41, score: 90 }
		});
	});

	it('rejects other files', () => {
		expect(() => parseMal('<html></html>')).toThrow('MyAnimeList');
	});

	it('reads gzipped exports', async () => {
		const gz = await new Response(
			new Blob([malXml]).stream().pipeThrough(new CompressionStream('gzip'))
		).blob();
		expect(await readMalFile(gz)).toBe(malXml);
		expect(await readMalFile(new Blob([malXml]))).toBe(malXml);
	});

	it('attaches AniList media by MAL id, leaving unknown ones unresolved', async () => {
		const asked: [number[], string][] = [];
		const anilist = {
			byMalIds: async (ids: number[], type: string) => {
				asked.push([ids, type]);
				return new Map(
					ids
						.filter((id) => id !== 21)
						.map((id) => [id, { media: { title: `#${id}` } } as ProviderMedia])
				);
			}
		} as unknown as AniListClient;
		const items = await resolveMal(anilist, parseMal(malXml));
		expect(asked).toEqual([
			[[52991, 21], 'anime'],
			[[2], 'manga']
		]);
		expect(items.map((i) => i.media?.media.title ?? null)).toEqual(['#52991', null, '#2']);
	});
});

describe('Trakt', () => {
	const work = (title: string, tmdb: number | null) => ({
		title,
		year: 2020,
		ids: { trakt: tmdb ?? 1, slug: title.toLowerCase(), tmdb }
	});

	it('merges watchlist, watched items and ratings into one row per title', async () => {
		const routes: Record<string, unknown> = {
			'/watchlist/movies': [{ movie: work('Later', 10) }, { movie: work('Seen', 11) }],
			'/watchlist/shows': [],
			'/watched/movies': [
				{ plays: 2, last_watched_at: '2024-05-01T20:00:00.000Z', movie: work('Seen', 11) }
			],
			// As served today: no seasons, plays include rewatches
			'/watched/shows': [
				{ plays: 5, last_watched_at: null, show: work('Show', 20) },
				{ plays: 3, last_watched_at: null, show: work('No history', 21) }
			],
			'/history/episodes': [
				{ episode: { season: 1, number: 1 }, show: work('Show', 20) },
				{ episode: { season: 1, number: 1 }, show: work('Show', 20) }, // rewatch
				{ episode: { season: 1, number: 2 }, show: work('Show', 20) },
				{ episode: { season: 0, number: 1 }, show: work('Show', 20) } // special
			],
			'/ratings/movies': [
				{ rating: 8, movie: work('Rated only', 12) },
				{ rating: 7, movie: work('Seen', 11) }
			],
			'/ratings/shows': [{ rating: 9, show: work('No id', null) }]
		};
		const headers: Record<string, string>[] = [];
		const fetch: Fetch = async (url, init) => {
			headers.push(init?.headers as Record<string, string>);
			const { pathname } = new URL(String(url));
			const path = Object.keys(routes).find((p) => pathname.endsWith(p))!;
			return json(routes[path]);
		};
		const items = await createTraktClient({ clientId: 'cid', fetch, limiter: noWait }).userLibrary(
			'me'
		);

		expect(headers[0]).toMatchObject({ 'trakt-api-key': 'cid', 'trakt-api-version': '2' });
		const byLabel = Object.fromEntries(items!.map((i) => [i.label, i]));
		expect(byLabel['Later (2020)'].entry.status).toBe('planned');
		expect(byLabel['Seen (2020)']).toMatchObject({
			type: 'movie',
			ref: { provider: 'tmdb', externalId: '11' },
			entry: { status: 'completed', completedOn: '2024-05-01', repeatCount: 1, score: 70 }
		});
		expect(byLabel['Show (2020)'].entry).toMatchObject({ status: 'in_progress', progress: 2 });
		expect(byLabel['No history (2020)'].entry.progress).toBe(3); // falls back to plays
		expect(byLabel['Rated only (2020)'].entry).toMatchObject({ status: 'completed', score: 80 });
		expect(byLabel['No id (2020)'].ref).toBeUndefined();
		expect(items).toHaveLength(6);
	});

	it('reads every page of a list', async () => {
		const movie = (n: number) => ({ plays: 1, last_watched_at: null, movie: work(`M${n}`, n) });
		const pages: string[] = [];
		const fetch: Fetch = async (url) => {
			const u = new URL(String(url));
			if (!u.pathname.endsWith('/watched/movies')) return json([]);
			const page = Number(u.searchParams.get('page'));
			pages.push(`${page}/${u.searchParams.get('limit')}`);
			const size = page === 1 ? 250 : 3;
			return json(Array.from({ length: size }, (_, i) => movie(page * 1000 + i)));
		};
		const items = await createTraktClient({ clientId: 'c', fetch, limiter: noWait }).userLibrary(
			'me'
		);
		expect(pages).toEqual(['1/250', '2/250']);
		expect(items).toHaveLength(253);
	});

	it('trades an OAuth code for a token and reads the private profile with it', async () => {
		const calls: { url: string; init?: RequestInit }[] = [];
		const fetch: Fetch = async (url, init) => {
			calls.push({ url: String(url), init });
			if (String(url).endsWith('/oauth/token')) return json({ access_token: 'tok' });
			return json([]);
		};
		const client = createTraktClient({ clientId: 'c', fetch, limiter: noWait });
		const token = await client.exchangeCode('code1', 'https://vulu.test/import/trakt', 'verif');
		expect(token).toBe('tok');
		expect(JSON.parse(String(calls[0].init?.body))).toEqual({
			code: 'code1',
			redirect_uri: 'https://vulu.test/import/trakt',
			grant_type: 'authorization_code',
			code_verifier: 'verif',
			client_id: 'c'
		});
		await client.userLibrary('me', token!);
		expect(calls[1].url).toContain('/users/me/');
		expect(calls[1].init?.headers).toMatchObject({ Authorization: 'Bearer tok' });

		const refused = createTraktClient({
			clientId: 'c',
			fetch: async () => json({ error: 'invalid_grant' }, 401),
			limiter: noWait
		});
		expect(await refused.exchangeCode('old', 'x', 'v')).toBeNull();
	});

	it('returns null for a private or unknown profile', async () => {
		const privateFetch: Fetch = async () => json({}, 401);
		expect(
			await createTraktClient({ clientId: 'c', fetch: privateFetch, limiter: noWait }).userLibrary(
				'x'
			)
		).toBeNull();
		const unknownFetch: Fetch = async () => json({}, 404);
		expect(
			await createTraktClient({ clientId: 'c', fetch: unknownFetch, limiter: noWait }).userLibrary(
				'x'
			)
		).toBeNull();
	});
});

// Integration: needs a migrated database (pnpm db:up && pnpm db:migrate).
describe('runImport with provider ids', () => {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set');
	const db = createDb(url);
	const run = randomUUID().slice(0, 8);
	let userId = '';

	afterAll(async () => {
		const ids = await db
			.select({ id: libraryEntries.mediaId })
			.from(libraryEntries)
			.where(eq(libraryEntries.userId, userId));
		await db.delete(users).where(eq(users.id, userId));
		await db.delete(media).where(
			inArray(
				media.id,
				ids.map((i) => i.id)
			)
		);
		await db.$client.end();
	});

	it('imports TMDB ids and completes finished shows whose episodes were all seen', async () => {
		[{ id: userId }] = await db
			.insert(users)
			.values({ email: `trk-${run}@test.vulu`, username: `trk_${run}` })
			.returning({ id: users.id });
		const show = (id: string, status: 'finished' | 'releasing'): ProviderMedia => ({
			media: { type: 'tv', title: `Show ${run} ${id}`, status, totalUnits: 2 },
			externalIds: [{ provider: 'tmdb', externalId: `test-${run}-${id}` }],
			titles: []
		});
		const providers = {
			tv: {
				name: 'tmdb',
				client: {
					types: ['tv'],
					search: async () => [],
					get: async (id: string) =>
						id.endsWith('ended') ? show('ended', 'finished') : show('airing', 'releasing')
				}
			}
		} as unknown as Providers;
		const entry = {
			status: 'in_progress' as const,
			progress: 2,
			progressSecondary: 0,
			score: null,
			startedOn: null,
			completedOn: null,
			repeatCount: 0,
			review: null,
			notes: null
		};
		const ref = (id: string) => ({ provider: 'tmdb' as const, externalId: `test-${run}-${id}` });
		const stats = await runImport(db, providers, {
			importId: 0,
			userId,
			source: 'trakt',
			items: [
				{ label: 'Ended', type: 'tv', ref: ref('ended'), entry },
				{ label: 'Airing', type: 'tv', ref: ref('airing'), entry },
				{ label: 'Wrong provider', type: 'tv', ref: { provider: 'imdb', externalId: 'tt1' }, entry }
			]
		});
		expect(stats).toMatchObject({ imported: 2, unmatched: 1 });

		const rows = await db
			.select({ title: media.title, status: libraryEntries.status })
			.from(libraryEntries)
			.innerJoin(media, eq(media.id, libraryEntries.mediaId))
			.where(eq(libraryEntries.userId, userId));
		const statusOf = (t: string) => rows.find((r) => r.title.endsWith(t))?.status;
		expect(statusOf('ended')).toBe('completed');
		expect(statusOf('airing')).toBe('in_progress'); // more episodes to come
	});
});
