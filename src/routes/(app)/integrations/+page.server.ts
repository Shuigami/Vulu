import { randomBytes } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/app.ts';
import { integrations } from '#lib/server/db/schema.ts';
import { JELLYFIN_TEMPLATE } from '#lib/server/jellyfin.ts';
import type { RecentEvent } from '#lib/server/scrobble.ts';
import type { Actions, PageServerLoad } from './$types';

/** 32 random bytes: the webhook URL is the only credential Jellyfin holds. */
const newToken = () => randomBytes(32).toString('base64url');
const mine = (userId: string) =>
	and(eq(integrations.userId, userId), eq(integrations.kind, 'jellyfin'));

export const load: PageServerLoad = async ({ locals, url }) => {
	const [jellyfin] = await db.select().from(integrations).where(mine(locals.user!.id));
	const settings = (jellyfin?.settings ?? {}) as { jellyfinUser?: string; recent?: RecentEvent[] };
	return {
		jellyfin: jellyfin && {
			enabled: jellyfin.enabled,
			webhookUrl: `${url.origin}/hooks/jellyfin/${jellyfin.webhookToken}`,
			jellyfinUser: settings.jellyfinUser ?? '',
			lastEventAt: jellyfin.lastSyncedAt?.toISOString() ?? null,
			recent: settings.recent ?? []
		},
		template: JELLYFIN_TEMPLATE
	};
};

export const actions: Actions = {
	create: async ({ locals }) => {
		await db
			.insert(integrations)
			.values({ userId: locals.user!.id, kind: 'jellyfin', webhookToken: newToken() })
			.onConflictDoNothing();
	},

	/** Invalidates the old URL, e.g. if it leaked. */
	regenerate: async ({ locals }) => {
		await db.update(integrations).set({ webhookToken: newToken() }).where(mine(locals.user!.id));
	},

	save: async ({ request, locals }) => {
		const form = await request.formData();
		const jellyfinUser = String(form.get('jellyfinUser') ?? '').trim();
		if (jellyfinUser.length > 100) return fail(400, { error: 'Nom d’utilisateur trop long.' });
		const [current] = await db
			.select({ settings: integrations.settings })
			.from(integrations)
			.where(mine(locals.user!.id));
		if (!current) return fail(404, { error: 'Intégration introuvable.' });
		await db
			.update(integrations)
			.set({
				enabled: form.get('enabled') === 'on',
				settings: { ...current.settings, jellyfinUser: jellyfinUser || undefined }
			})
			.where(mine(locals.user!.id));
		return { saved: true };
	},

	remove: async ({ locals }) => {
		await db.delete(integrations).where(mine(locals.user!.id));
	}
};
