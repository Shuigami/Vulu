import { randomUUID } from 'node:crypto';
import { like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../db';
import { invites, users } from '../db/schema';
import { createAuth } from '.';
import { usernameBase } from './username';

// Integration test: needs a migrated database (pnpm db:up && pnpm db:migrate).
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const db = createDb(url);
const auth = createAuth(db, {
	secret: 'test-secret-test-secret-test-secret',
	baseURL: 'http://localhost:5173'
});

// Every address of this run shares a unique domain, so cleanup never touches real data.
const domain = `${randomUUID().slice(0, 8)}.test.vulu`;
const email = (local: string) => `${local}@${domain}`;
const invite = (address: string) => db.insert(invites).values({ email: address });
const signUp = (body: { email: string; username?: string }) =>
	auth.api.signUpEmail({ body: { password: 'correct horse battery', name: 'Test', ...body } });

afterAll(async () => {
	await db.delete(users).where(like(users.email, `%@${domain}`));
	await db.delete(invites).where(like(invites.email, `%@${domain}`));
	await db.$client.end();
});

describe('sign-up', () => {
	it('rejects an e-mail that was not invited', async () => {
		await expect(signUp({ email: email('stranger'), username: 'stranger' })).rejects.toMatchObject({
			body: { code: 'NOT_INVITED' }
		});
	});

	it('creates the user with the chosen username and marks the invite as used', async () => {
		const address = email('alice');
		await invite(address);
		const username = `alice_${domain.slice(0, 8)}`;
		const res = await signUp({ email: address, username });
		expect(res.user).toMatchObject({ email: address, username });

		const [row] = await db.select().from(invites).where(like(invites.email, address));
		expect(row.usedAt).toBeInstanceOf(Date);

		const signIn = await auth.api.signInEmail({
			body: { email: address, password: 'correct horse battery' }
		});
		expect(signIn.token).toBeTruthy();
	});

	it('rejects an invalid username', async () => {
		const address = email('bob');
		await invite(address);
		await expect(signUp({ email: address, username: 'no spaces!' })).rejects.toMatchObject({
			body: { code: 'INVALID_USERNAME' }
		});
	});

	it('derives a free username when none is given (OAuth sign-up)', async () => {
		const local = `carol${domain.slice(0, 8)}`;
		const first = email(local);
		const second = `${local}@other-${domain}`;
		await invite(first);
		await invite(second);

		const a = await signUp({ email: first });
		const b = await signUp({ email: second });
		expect((a.user as { username: string }).username).toBe(local);
		expect((b.user as { username: string }).username).toBe(`${local}_2`);
		await db.delete(users).where(like(users.email, second));
		await db.delete(invites).where(like(invites.email, second));
	});
});

describe('usernameBase', () => {
	it('keeps only allowed characters', () => {
		expect(usernameBase('jean.dupont')).toBe('jean_dupont');
		expect(usernameBase('Élodie')).toBe('Elodie');
		expect(usernameBase('a')).toBe('a__');
		expect(usernameBase('...')).toBe('user');
		expect(usernameBase('x'.repeat(40))).toHaveLength(24);
	});
});
