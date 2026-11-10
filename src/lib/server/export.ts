// Full export of a user's library and journal (docs/v1-spec.md: "Export complet JSON et CSV").
import { and, asc, eq, sql } from 'drizzle-orm';
import type { MediaType } from '../labels';
import type { Db } from './db';
import { activityEvents, libraryEntries, media, mediaExternalIds, users } from './db/schema';

const ID_PROVIDERS = ['tmdb', 'imdb', 'anilist', 'mal', 'openlibrary', 'isbn13'] as const;

/** Everything, or only one media type when `type` is given. */
export async function exportData(db: Db, userId: string, type?: MediaType, now = new Date()) {
	const ofType = type ? eq(media.type, type) : undefined;
	const externalIds = db
		.select({
			mediaId: mediaExternalIds.mediaId,
			ids: sql<
				Record<string, string>
			>`jsonb_object_agg(${mediaExternalIds.provider}, ${mediaExternalIds.externalId})`.as('ids')
		})
		.from(mediaExternalIds)
		.groupBy(mediaExternalIds.mediaId)
		.as('external_ids');

	const [user] = await db
		.select({ username: users.username, ratingScale: users.ratingScale })
		.from(users)
		.where(eq(users.id, userId));

	const entries = await db
		.select({
			title: media.title,
			type: media.type,
			year: sql<number | null>`extract(year from ${media.startDate})::int`,
			status: libraryEntries.status,
			score: libraryEntries.score,
			progress: libraryEntries.progress,
			progressSecondary: libraryEntries.progressSecondary,
			repeatCount: libraryEntries.repeatCount,
			startedOn: libraryEntries.startedOn,
			completedOn: libraryEntries.completedOn,
			isFavorite: libraryEntries.isFavorite,
			isPrivate: libraryEntries.isPrivate,
			review: libraryEntries.review,
			notes: libraryEntries.notes,
			addedAt: libraryEntries.createdAt,
			updatedAt: libraryEntries.updatedAt,
			externalIds: sql<Record<string, string>>`coalesce(${externalIds.ids}, '{}'::jsonb)`
		})
		.from(libraryEntries)
		.innerJoin(media, eq(media.id, libraryEntries.mediaId))
		.leftJoin(externalIds, eq(externalIds.mediaId, media.id))
		.where(and(eq(libraryEntries.userId, userId), ofType))
		.orderBy(asc(media.title));

	const history = await db
		.select({
			occurredAt: activityEvents.occurredAt,
			title: media.title,
			type: media.type,
			kind: activityEvents.kind,
			amount: activityEvents.amount,
			minutes: activityEvents.minutes,
			source: activityEvents.source
		})
		.from(activityEvents)
		.innerJoin(media, eq(media.id, activityEvents.mediaId))
		.where(and(eq(activityEvents.userId, userId), ofType))
		.orderBy(asc(activityEvents.occurredAt));

	return {
		exportedAt: now.toISOString(),
		user,
		type: type ?? 'all',
		scoreScale: 100, // scores are exported as stored, out of 100
		entries,
		history
	};
}

const CSV_COLUMNS = [
	'title',
	'type',
	'year',
	'status',
	'score_100',
	'progress',
	'progress_secondary',
	'repeat_count',
	'started_on',
	'completed_on',
	'favorite',
	'private',
	'review',
	'notes',
	'added_at',
	...ID_PROVIDERS
];

/** RFC 4180 field: quoted when it holds a comma, a quote or a line break. */
const field = (v: unknown) => {
	const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
	return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** One row per library entry. Starts with a BOM so Excel reads UTF-8 accents. */
export function entriesCsv(entries: Awaited<ReturnType<typeof exportData>>['entries']) {
	const rows = entries.map((e) => [
		e.title,
		e.type,
		e.year,
		e.status,
		e.score,
		e.progress,
		e.progressSecondary,
		e.repeatCount,
		e.startedOn,
		e.completedOn,
		e.isFavorite,
		e.isPrivate,
		e.review,
		e.notes,
		e.addedAt,
		...ID_PROVIDERS.map((p) => e.externalIds[p])
	]);
	return '﻿' + [CSV_COLUMNS, ...rows].map((r) => r.map(field).join(',')).join('\r\n') + '\r\n';
}
