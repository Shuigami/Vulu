// Catalogue feeding: provider search and import, run by the worker (only it calls the APIs).
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './db';
import { media, mediaExternalIds, mediaTitles } from './db/schema';
import { createAniListClient } from './providers/anilist';
import { cached, DAY } from './providers/cache';
import { createOpenLibraryClient } from './providers/openlibrary';
import { createTmdbClient } from './providers/tmdb';
import type {
	MediaType,
	Provider,
	ProviderClient,
	ProviderMedia,
	SearchResult
} from './providers/types';

/** Source of truth per media type (docs/v1-spec.md). */
export type Providers = Record<MediaType, { name: Provider; client: ProviderClient }>;

export function createProviders(env: { TMDB_API_KEY?: string }): Providers {
	const tmdb: ProviderClient = env.TMDB_API_KEY
		? createTmdbClient({ apiKey: env.TMDB_API_KEY })
		: {
				types: ['movie', 'tv'],
				search: () => Promise.reject(new Error('TMDB_API_KEY is not set')),
				get: () => Promise.reject(new Error('TMDB_API_KEY is not set'))
			};
	const anilist = createAniListClient();
	const openlibrary = createOpenLibraryClient();
	return {
		movie: { name: 'tmdb', client: tmdb },
		tv: { name: 'tmdb', client: tmdb },
		anime: { name: 'anilist', client: anilist },
		manga: { name: 'anilist', client: anilist },
		book: { name: 'openlibrary', client: openlibrary }
	};
}

const normalize = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ');

export async function searchProvider(
	db: Db,
	providers: Providers,
	type: MediaType,
	query: string
): Promise<SearchResult[]> {
	const q = normalize(query);
	if (!q) return [];
	const { name, client } = providers[type];
	return (await cached(db, `${name}:search:${type}:${q}`, DAY, () => client.search(q, type))) ?? [];
}

/** Fetches a media from its provider and stores it; returns its id, or null if the provider does not know it. */
export async function importMedia(
	db: Db,
	providers: Providers,
	type: MediaType,
	externalId: string
): Promise<number | null> {
	const { name, client } = providers[type];
	const data = await cached(db, `${name}:media:${type}:${externalId}`, DAY, () =>
		client.get(externalId, type)
	);
	return data ? upsertMedia(db, data) : null;
}

/** Inserts or refreshes a media, matched on its primary external id. */
export function upsertMedia(db: Db, data: ProviderMedia): Promise<number> {
	const [primary, ...others] = data.externalIds;
	return db.transaction(async (tx) => {
		// Serializes concurrent imports of the same work, so it is never created twice
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext(${`${primary.provider}:${primary.externalId}`}))`
		);
		const [existing] = await tx
			.select({ id: mediaExternalIds.mediaId })
			.from(mediaExternalIds)
			.where(
				and(
					eq(mediaExternalIds.provider, primary.provider),
					eq(mediaExternalIds.externalId, primary.externalId)
				)
			);

		let mediaId: number;
		if (existing) {
			mediaId = existing.id;
			await tx.update(media).set(data.media).where(eq(media.id, mediaId));
		} else {
			[{ id: mediaId }] = await tx.insert(media).values(data.media).returning({ id: media.id });
			await tx.insert(mediaExternalIds).values({ mediaId, ...primary, isPrimary: true });
		}
		// Secondary ids may already belong to another media (e.g. a TMDB entry of the same anime): keep theirs.
		if (others.length) {
			await tx
				.insert(mediaExternalIds)
				.values(others.map((id) => ({ mediaId, ...id })))
				.onConflictDoNothing();
		}
		if (data.titles.length) {
			await tx
				.insert(mediaTitles)
				.values(data.titles.map((t) => ({ mediaId, ...t })))
				.onConflictDoNothing();
		}
		return mediaId;
	});
}
