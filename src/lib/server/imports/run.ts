// Runs a library import in the worker: resolves each row to a catalogue media, then adds it
// to the user's library. Existing entries are kept as they are (V1 choice).
import { eq } from 'drizzle-orm';
import { upsertMedia, type Providers } from '../catalogue';
import type { Db } from '../db';
import { activityEvents, importJobs, libraryEntries, media } from '../db/schema';
import { cached, DAY } from '../providers/cache';
import type { ImportItem, ImportedEntry, ImportSource, Unmatched } from './types';

type Stats = { total: number; imported: number; kept: number; unmatched: number };

const progressKind = { tv: 'episode', anime: 'episode', manga: 'chapter', book: 'pages' } as const;

async function resolve(db: Db, providers: Providers, item: ImportItem): Promise<number | null> {
	if (item.media) return upsertMedia(db, item.media);
	if (item.lookup && providers.book.client.lookup) {
		const { lookup } = item;
		const key = `openlibrary:lookup:${lookup.isbn13 || lookup.isbn || `${lookup.title}|${lookup.author ?? ''}`}`;
		const found = await cached(db, key.toLowerCase(), 7 * DAY, () =>
			providers.book.client.lookup!(lookup)
		);
		return found ? upsertMedia(db, found) : null;
	}
	return null;
}

/**
 * Adds an imported entry unless the user already has one, and writes its history to the
 * journal (source "import"). Dedup keys make a replayed import add nothing.
 */
export async function saveImportedEntry(
	db: Db,
	userId: string,
	mediaId: number,
	source: ImportSource,
	e: ImportedEntry
): Promise<'imported' | 'kept'> {
	return db.transaction(async (tx) => {
		const [created] = await tx
			.insert(libraryEntries)
			.values({ userId, mediaId, ...e })
			.onConflictDoNothing()
			.returning({ id: libraryEntries.id });
		if (!created) return 'kept';

		const [m] = await tx
			.select({ type: media.type, runtime: media.runtimeMinutes })
			.from(media)
			.where(eq(media.id, mediaId));
		const at = (date: string | null) => (date ? new Date(`${date}T12:00:00Z`) : new Date());
		const when = at(e.completedOn ?? e.startedOn);
		const key = (kind: string) => `import:${source}:${mediaId}:${kind}`;
		const events: Omit<typeof activityEvents.$inferInsert, 'userId' | 'mediaId'>[] = [];
		if (e.progress > 0 && m.type !== 'movie') {
			const perUnit = m.type === 'tv' || m.type === 'anime' ? m.runtime : null;
			events.push({
				kind: progressKind[m.type],
				amount: e.progress,
				minutes: perUnit ? perUnit * e.progress : null,
				occurredAt: when,
				dedupKey: key('progress')
			});
		}
		if (e.status === 'completed') {
			events.push({ kind: 'completed', occurredAt: when, dedupKey: key('completed') });
		}
		if (e.score !== null) {
			events.push({ kind: 'rated', amount: e.score, occurredAt: when, dedupKey: key('rated') });
		}
		if (events.length) {
			await tx
				.insert(activityEvents)
				.values(events.map((ev) => ({ ...ev, userId, mediaId, source: 'import' as const })))
				.onConflictDoNothing();
		}
		return 'imported';
	});
}

/** Processes all rows of an import job and records its outcome in import_jobs. */
export async function runImport(
	db: Db,
	providers: Providers,
	job: { importId: number; userId: string; source: ImportSource; items: ImportItem[] }
): Promise<Stats> {
	await db.update(importJobs).set({ status: 'running' }).where(eq(importJobs.id, job.importId));
	const stats: Stats = { total: job.items.length, imported: 0, kept: 0, unmatched: 0 };
	const unmatched: Unmatched[] = [];
	try {
		for (const item of job.items) {
			let mediaId: number | null = null;
			try {
				mediaId = await resolve(db, providers, item);
			} catch (err) {
				// One bad row (provider error, odd data) must not fail the whole import
				console.error(`[import ${job.importId}] ${item.label}`, err);
			}
			if (!mediaId) {
				stats.unmatched++;
				unmatched.push({ label: item.label, type: item.type, reason: 'not_found' });
				continue;
			}
			stats[await saveImportedEntry(db, job.userId, mediaId, job.source, item.entry)]++;
		}
		await db
			.update(importJobs)
			.set({ status: 'done', stats, unmatched, finishedAt: new Date() })
			.where(eq(importJobs.id, job.importId));
	} catch (err) {
		await db
			.update(importJobs)
			.set({ status: 'failed', stats, unmatched, error: String(err), finishedAt: new Date() })
			.where(eq(importJobs.id, job.importId));
		throw err;
	}
	return stats;
}
