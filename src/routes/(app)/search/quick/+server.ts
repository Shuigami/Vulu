import { json } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/app.ts';
import { libraryEntries, media } from '#lib/server/db/schema.ts';
import { searchMedia } from '#lib/server/search.ts';
import { isMediaType } from '#lib/labels.ts';
import type { RequestHandler } from './$types';

/**
 * Quick-add search: the local catalogue (no provider call), with what the dialog previews
 * (overview, total units) and the viewer's own entry when the title is already in their library.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const q = url.searchParams.get('q')?.trim().slice(0, 200) ?? '';
	const t = url.searchParams.get('type');
	if (q.length < 2) return json([]);
	const results = await searchMedia(db, q, { limit: 9, type: isMediaType(t) ? t : undefined });
	if (!results.length) return json([]);
	const ids = results.map((r) => r.id);
	const [details, entries] = await Promise.all([
		db
			.select({ id: media.id, overview: media.overview, totalUnits: media.totalUnits })
			.from(media)
			.where(inArray(media.id, ids)),
		locals.user
			? db
					.select({
						mediaId: libraryEntries.mediaId,
						status: libraryEntries.status,
						progress: libraryEntries.progress
					})
					.from(libraryEntries)
					.where(
						and(eq(libraryEntries.userId, locals.user.id), inArray(libraryEntries.mediaId, ids))
					)
			: []
	]);
	const detail = new Map(details.map((d) => [d.id, d]));
	const entry = new Map(entries.map((e) => [e.mediaId, e]));
	return json(
		results.map(({ id, type, title, posterUrl, year }) => ({
			id,
			type,
			title,
			posterUrl,
			year,
			overview: detail.get(id)?.overview ?? null,
			totalUnits: detail.get(id)?.totalUnits ?? null,
			entry: entry.get(id) ?? null
		}))
	);
};
