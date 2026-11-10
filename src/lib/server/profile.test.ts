import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from './db';
import { users } from './db/schema';
import {
	AVATAR_MAX_BYTES,
	getAvatar,
	imageType,
	removeAvatar,
	saveAvatar,
	setDisplayName
} from './profile';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBPVP8 ')]);

describe('imageType', () => {
	it('reads the type from the bytes', () => {
		expect(imageType(PNG)).toBe('image/png');
		expect(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
		expect(imageType(WEBP)).toBe('image/webp');
		expect(imageType(new Uint8Array(Buffer.from('<svg onload=alert(1)>')))).toBeNull();
	});
});

// Integration: needs a migrated database (pnpm db:up && pnpm db:migrate).
describe('profile in the database', () => {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set');
	const db = createDb(url);
	const run = randomUUID().slice(0, 8);
	let userId = '';

	afterAll(async () => {
		await db.delete(users).where(eq(users.id, userId));
		await db.$client.end();
	});

	it('saves the name and the avatar, then removes the avatar', async () => {
		[{ id: userId }] = await db
			.insert(users)
			.values({ email: `profile-${run}@test.vulu`, username: `profile_${run}` })
			.returning({ id: users.id });
		const user = async () => (await db.select().from(users).where(eq(users.id, userId)))[0];

		await setDisplayName(db, userId, '  Shui  ');
		expect((await user()).displayName).toBe('Shui');
		await setDisplayName(db, userId, '   ');
		expect((await user()).displayName).toBeNull();

		expect(await saveAvatar(db, userId, new Uint8Array([1, 2, 3]))).toBe('invalid');
		const big = new Uint8Array(AVATAR_MAX_BYTES + 1);
		big.set(PNG);
		expect(await saveAvatar(db, userId, big)).toBe('too_large');
		expect(await getAvatar(db, userId)).toBeNull();

		expect(await saveAvatar(db, userId, WEBP)).toBe('saved');
		expect((await user()).avatarUrl).toMatch(new RegExp(`^/avatars/${userId}\\?v=\\d+$`));
		expect(await getAvatar(db, userId)).toMatchObject({ contentType: 'image/webp' });
		expect(await saveAvatar(db, userId, PNG)).toBe('saved');
		expect((await getAvatar(db, userId))?.contentType).toBe('image/png');

		await removeAvatar(db, userId);
		expect((await user()).avatarUrl).toBeNull();
		expect(await getAvatar(db, userId)).toBeNull();
	});
});
