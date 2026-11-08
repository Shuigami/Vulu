// Library entries: current state in library_entries, history in activity_events (docs/v1-spec.md).
import { and, eq, sql } from 'drizzle-orm';
import type { MediaType } from '../labels';
import type { Db } from './db';
import { activityEvents, libraryEntries, media } from './db/schema';

type Entry = typeof libraryEntries.$inferSelect;
type EventInsert = typeof activityEvents.$inferInsert;

export type EntryPatch = Partial<
	Pick<
		Entry,
		| 'status'
		| 'progress'
		| 'progressSecondary'
		| 'score'
		| 'startedOn'
		| 'completedOn'
		| 'notes'
		| 'review'
		| 'isFavorite'
	>
>;

type MediaInfo = { type: MediaType; totalUnits: number | null; runtimeMinutes: number | null };
type Event = Pick<EventInsert, 'kind' | 'amount' | 'minutes'>;

const progressKind = { tv: 'episode', anime: 'episode', manga: 'chapter', book: 'pages' } as const;

/**
 * Applies a user change and the automatic rules, and lists the activity events it produces.
 * Pure, so the rules are easy to test.
 */
export function applyChange(
	current: Entry,
	patch: EntryPatch,
	m: MediaInfo,
	today: string
): { next: Entry; events: Event[] } {
	const next = { ...current, ...patch };
	const total = m.totalUnits ?? null;

	next.progress = Math.max(0, total ? Math.min(next.progress, total) : next.progress);
	next.progressSecondary = Math.max(0, next.progressSecondary);

	// Status follows progress unless the user changed the status in the same edit
	if (patch.status === undefined && next.progress !== current.progress) {
		if (total && next.progress === total) next.status = 'completed';
		else if (next.progress > 0 && ['planned', 'completed'].includes(next.status))
			next.status = 'in_progress';
	}
	if (next.status === 'completed' && total && patch.progress === undefined) next.progress = total;
	if (next.status === 'in_progress' || next.status === 'completed') next.startedOn ??= today;
	if (next.status === 'completed') next.completedOn ??= today;

	const events: Event[] = [];
	const delta = next.progress - current.progress;
	if (delta > 0 && m.type !== 'movie') {
		const perUnit = m.type === 'tv' || m.type === 'anime' ? m.runtimeMinutes : null;
		events.push({
			kind: progressKind[m.type],
			amount: delta,
			minutes: perUnit ? perUnit * delta : null
		});
	}
	if (next.status !== current.status) {
		if (next.status === 'completed') {
			events.push({
				kind: 'completed',
				amount: null,
				minutes: m.type === 'movie' ? m.runtimeMinutes : null
			});
		} else if (next.status === 'in_progress' && current.status === 'planned') {
			events.push({ kind: 'started', amount: null, minutes: null });
		} else {
			events.push({ kind: 'status_changed', amount: null, minutes: null });
		}
	}
	if (next.score !== null && next.score !== current.score) {
		events.push({ kind: 'rated', amount: next.score, minutes: null });
	}
	return { next, events };
}

/** Adds a media to the user's library (status "planned"); returns the entry id, existing or new. */
export async function addToLibrary(db: Db, userId: string, mediaId: number): Promise<number> {
	const [created] = await db
		.insert(libraryEntries)
		.values({ userId, mediaId })
		.onConflictDoNothing()
		.returning({ id: libraryEntries.id });
	if (created) return created.id;
	const [existing] = await db
		.select({ id: libraryEntries.id })
		.from(libraryEntries)
		.where(and(eq(libraryEntries.userId, userId), eq(libraryEntries.mediaId, mediaId)));
	return existing.id;
}

/** Updates one of the user's entries; returns false if it is not theirs. */
export async function updateEntry(
	db: Db,
	userId: string,
	entryId: number,
	patch: EntryPatch | ((current: Entry) => EntryPatch),
	today = new Date().toISOString().slice(0, 10)
): Promise<boolean> {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select({
				entry: libraryEntries,
				type: media.type,
				totalUnits: media.totalUnits,
				runtimeMinutes: media.runtimeMinutes
			})
			.from(libraryEntries)
			.innerJoin(media, eq(media.id, libraryEntries.mediaId))
			.where(and(eq(libraryEntries.id, entryId), eq(libraryEntries.userId, userId)))
			.for('update', { of: libraryEntries });
		if (!row) return false;

		const p = typeof patch === 'function' ? patch(row.entry) : patch;
		const { next, events } = applyChange(row.entry, p, row, today);
		const { status, progress, progressSecondary, score, startedOn, completedOn } = next;
		const { notes, review, isFavorite, mediaId } = next;
		await tx
			.update(libraryEntries)
			.set({
				status,
				progress,
				progressSecondary,
				score,
				startedOn,
				completedOn,
				notes,
				review,
				isFavorite
			})
			.where(eq(libraryEntries.id, entryId));
		if (events.length) {
			await tx.insert(activityEvents).values(events.map((e) => ({ ...e, userId, mediaId })));
		}
		return true;
	});
}

/** +1 episode / chapter / page, used by the "En cours" page. */
export const incrementProgress = (db: Db, userId: string, entryId: number) =>
	updateEntry(db, userId, entryId, (e) => ({ progress: e.progress + 1 }));

export async function removeEntry(db: Db, userId: string, entryId: number) {
	await db
		.delete(libraryEntries)
		.where(and(eq(libraryEntries.id, entryId), eq(libraryEntries.userId, userId)));
}

/** The user's entries with their media, most recently updated first. */
export function listEntries(
	db: Db,
	userId: string,
	filters: { type?: MediaType; status?: Entry['status'] } = {}
) {
	return db
		.select({
			id: libraryEntries.id,
			status: libraryEntries.status,
			progress: libraryEntries.progress,
			progressSecondary: libraryEntries.progressSecondary,
			score: libraryEntries.score,
			mediaId: media.id,
			type: media.type,
			title: media.title,
			posterUrl: media.posterUrl,
			totalUnits: media.totalUnits,
			year: sql<number | null>`extract(year from ${media.startDate})::int`
		})
		.from(libraryEntries)
		.innerJoin(media, eq(media.id, libraryEntries.mediaId))
		.where(
			and(
				eq(libraryEntries.userId, userId),
				filters.type ? eq(media.type, filters.type) : undefined,
				filters.status ? eq(libraryEntries.status, filters.status) : undefined
			)
		)
		.orderBy(sql`${libraryEntries.updatedAt} desc`);
}
