import { error, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/app.ts';
import { libraryEntries, media, mediaExternalIds } from '#lib/server/db/schema.ts';
import { addToLibrary, removeEntry, updateEntry, type EntryPatch } from '#lib/server/library.ts';
import { fromScale, isEntryStatus } from '#lib/labels.ts';
import type { Actions, PageServerLoad } from './$types';

const parseId = (raw: string) => {
	const id = Number(raw);
	if (!Number.isInteger(id) || id <= 0) error(404, 'Œuvre introuvable');
	return id;
};

export const load: PageServerLoad = async ({ params, locals }) => {
	const id = parseId(params.id);
	const [m] = await db.select().from(media).where(eq(media.id, id));
	if (!m) error(404, 'Œuvre introuvable');
	const [entry] = await db
		.select()
		.from(libraryEntries)
		.where(and(eq(libraryEntries.mediaId, id), eq(libraryEntries.userId, locals.user!.id)));
	const externalIds = await db
		.select({ provider: mediaExternalIds.provider, externalId: mediaExternalIds.externalId })
		.from(mediaExternalIds)
		.where(eq(mediaExternalIds.mediaId, id));
	return { media: m, entry: entry ?? null, externalIds };
};

/** Validates the library form; returns the fields or an error message (French, shown in the UI). */
function parseEntryForm(form: FormData, ratingScale: number): EntryPatch | string {
	const int = (name: string) => {
		const v = Number(form.get(name) || 0);
		return Number.isInteger(v) && v >= 0 && v <= 1_000_000 ? v : null;
	};
	const date = (name: string) => {
		const v = String(form.get(name) ?? '');
		return v === '' ? null : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
	};
	const text = (name: string) =>
		String(form.get(name) ?? '')
			.trim()
			.slice(0, 5000) || null;

	const status = form.get('status');
	if (!isEntryStatus(status)) return 'Statut invalide.';
	const progress = int('progress');
	const progressSecondary = int('progressSecondary');
	if (progress === null || progressSecondary === null) return 'Progression invalide.';

	const rawScore = String(form.get('score') ?? '').replace(',', '.');
	const scoreValue = Number(rawScore);
	if (rawScore !== '' && !(scoreValue >= 0 && scoreValue <= ratingScale))
		return `La note doit être comprise entre 0 et ${ratingScale}.`;
	const startedOn = date('startedOn');
	const completedOn = date('completedOn');
	if (startedOn === undefined || completedOn === undefined) return 'Date invalide.';

	return {
		status,
		progress,
		progressSecondary,
		score: rawScore === '' ? null : fromScale(scoreValue, ratingScale),
		startedOn,
		completedOn,
		notes: text('notes'),
		review: text('review'),
		isFavorite: form.get('isFavorite') === 'on'
	};
}

export const actions: Actions = {
	add: async ({ params, locals }) => {
		await addToLibrary(db, locals.user!.id, parseId(params.id));
	},

	update: async ({ request, locals }) => {
		const form = await request.formData();
		const entryId = Number(form.get('entryId'));
		const parsed = parseEntryForm(form, locals.user!.ratingScale ?? 10);
		if (typeof parsed === 'string') return fail(400, { error: parsed });
		// Only send what changed, so automatic rules (e.g. completing at the last episode) apply
		const ok = await updateEntry(db, locals.user!.id, entryId, (current) =>
			Object.fromEntries(
				Object.entries(parsed).filter(([k, v]) => current[k as keyof typeof current] !== v)
			)
		);
		if (!ok) error(404, 'Entrée introuvable');
		return { saved: true };
	},

	remove: async ({ request, locals }) => {
		const entryId = Number((await request.formData()).get('entryId'));
		await removeEntry(db, locals.user!.id, entryId);
	}
};
