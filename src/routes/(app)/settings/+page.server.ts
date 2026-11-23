import { fail } from '@sveltejs/kit';
import { VAPID_PUBLIC_KEY } from '$app/env/private';
import { count, eq } from 'drizzle-orm';
import { db, getBoss } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/guard.ts';
import { pushSubscriptions, users } from '#lib/server/db/schema.ts';
import { QUEUES, type PushTestJob } from '#lib/server/jobs.ts';
import { getNotificationSettings, setReleaseEmail } from '#lib/server/notifications.ts';
import { removeAvatar, saveAvatar, setDisplayName } from '#lib/server/profile.ts';
import { RATING_SCALES } from '#lib/labels.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, cookies, url }) => {
	const [u] = await db
		.select({
			profileVisibility: users.profileVisibility,
			ratingScale: users.ratingScale,
			displayName: users.displayName,
			avatarUrl: users.avatarUrl,
			email: users.email
		})
		.from(users)
		.where(eq(users.id, requireUser(locals, url).id));
	const userId = requireUser(locals, url).id;
	const [{ devices }] = await db
		.select({ devices: count() })
		.from(pushSubscriptions)
		.where(eq(pushSubscriptions.userId, userId));
	const notifications = {
		...(await getNotificationSettings(db, userId)),
		devices,
		// Without VAPID keys the page offers e-mail only
		vapidPublicKey: VAPID_PUBLIC_KEY ?? null
	};
	// Set by the theme choice below; hooks.server.ts applies it to every page
	const cookie = cookies.get('theme');
	const theme: 'light' | 'dark' | 'system' =
		(['light', 'dark'] as const).find((t) => t === cookie) ?? 'system';
	return { ...u, theme, notifications };
};

export const actions: Actions = {
	profile: async ({ request, locals, url }) => {
		const form = await request.formData();
		await setDisplayName(db, requireUser(locals, url).id, String(form.get('displayName') ?? ''));
		const file = form.get('avatar');
		if (file instanceof File && file.size > 0) {
			const result = await saveAvatar(
				db,
				requireUser(locals, url).id,
				new Uint8Array(await file.arrayBuffer())
			);
			if (result === 'invalid')
				return fail(400, { profileError: 'Choisis une image PNG, JPEG ou WebP.' });
			if (result === 'too_large')
				return fail(400, { profileError: 'Cette image est trop lourde.' });
		}
		return { profileSaved: true };
	},
	notifications: async ({ request, locals, url }) => {
		const form = await request.formData();
		await setReleaseEmail(db, requireUser(locals, url).id, form.get('releaseEmail') === 'on');
		return { notificationsSaved: true };
	},
	testPush: async ({ locals, url }) => {
		const job: PushTestJob = { userId: requireUser(locals, url).id };
		await (await getBoss()).send(QUEUES.pushTest, job);
		return { pushTestSent: true };
	},
	removeAvatar: async ({ locals, url }) => {
		await removeAvatar(db, requireUser(locals, url).id);
		return { profileSaved: true };
	},
	preferences: async ({ request, locals, url }) => {
		const form = await request.formData();
		const visibility = form.get('profileVisibility');
		const ratingScale = Number(form.get('ratingScale'));
		if (visibility !== 'public' && visibility !== 'private')
			return fail(400, { error: 'Visibilité invalide.' });
		if (!RATING_SCALES.includes(ratingScale as (typeof RATING_SCALES)[number]))
			return fail(400, { error: 'Échelle de notation invalide.' });
		await db
			.update(users)
			.set({ profileVisibility: visibility, ratingScale })
			.where(eq(users.id, requireUser(locals, url).id));
		return { saved: true };
	}
};
