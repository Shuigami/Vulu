import { db } from '#lib/server/app.ts';
import { LIBRARY_SORTS, listEntries, type LibrarySort } from '#lib/server/library.ts';
import { isEntryStatus, isMediaType } from '#lib/labels.ts';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 60;

export const load: PageServerLoad = async ({ url, locals }) => {
	const t = url.searchParams.get('type');
	const s = url.searchParams.get('status');
	const o = url.searchParams.get('sort');
	const type = isMediaType(t) ? t : undefined;
	const status = isEntryStatus(s) ? s : undefined;
	const sort = LIBRARY_SORTS.includes(o as LibrarySort) ? (o as LibrarySort) : 'updated';
	const q = url.searchParams.get('q')?.trim().slice(0, 100) || undefined;
	const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
	const entries = await listEntries(db, locals.user!.id, {
		type,
		status,
		q,
		sort,
		limit: PAGE_SIZE,
		offset: (page - 1) * PAGE_SIZE
	});
	// Past the last page no row carries the count: the page then shows its empty state
	const total = entries[0]?.total ?? 0;
	return { type, status, sort, q, page, pages: Math.ceil(total / PAGE_SIZE), total, entries };
};
