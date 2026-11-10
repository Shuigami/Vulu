// Profile edits: display name and uploaded avatar (stored in `avatars`, served at /avatars/<id>).
import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { avatars, users } from './db/schema';

export const DISPLAY_NAME_MAX = 50;
/** The browser sends a 256 px image of a few dozen KB; anything bigger is refused. */
export const AVATAR_MAX_BYTES = 300_000;

/** Image type from the first bytes, so the declared type is never trusted. */
export function imageType(bytes: Uint8Array): string | null {
	const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
	if (starts([0x89, 0x50, 0x4e, 0x47])) return 'image/png';
	if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
	if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
	return null;
}

export async function setDisplayName(db: Db, userId: string, name: string) {
	const value = name.trim().slice(0, DISPLAY_NAME_MAX) || null;
	await db.update(users).set({ displayName: value }).where(eq(users.id, userId));
}

/** Stores the avatar and points users.avatar_url at it, with a version so caches refresh. */
export async function saveAvatar(db: Db, userId: string, bytes: Uint8Array) {
	const contentType = imageType(bytes);
	if (!contentType) return 'invalid' as const;
	if (bytes.length > AVATAR_MAX_BYTES) return 'too_large' as const;
	const data = Buffer.from(bytes);
	await db.transaction(async (tx) => {
		await tx
			.insert(avatars)
			.values({ userId, contentType, data })
			.onConflictDoUpdate({
				target: avatars.userId,
				set: { contentType, data, updatedAt: new Date() }
			});
		await tx
			.update(users)
			.set({ avatarUrl: `/avatars/${userId}?v=${Date.now()}` })
			.where(eq(users.id, userId));
	});
	return 'saved' as const;
}

export async function removeAvatar(db: Db, userId: string) {
	await db.transaction(async (tx) => {
		await tx.delete(avatars).where(eq(avatars.userId, userId));
		await tx.update(users).set({ avatarUrl: null }).where(eq(users.id, userId));
	});
}

export async function getAvatar(db: Db, userId: string) {
	const [row] = await db
		.select({ contentType: avatars.contentType, data: avatars.data })
		.from(avatars)
		.where(eq(avatars.userId, userId));
	return row ?? null;
}
