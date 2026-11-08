import { db } from '#lib/server/app.ts';
import { listEntries } from '#lib/server/library.ts';
import { isEntryStatus, isMediaType } from '#lib/labels.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const t = url.searchParams.get('type');
	const s = url.searchParams.get('status');
	const type = isMediaType(t) ? t : undefined;
	const status = isEntryStatus(s) ? s : undefined;
	return { type, status, entries: await listEntries(db, locals.user!.id, { type, status }) };
};
