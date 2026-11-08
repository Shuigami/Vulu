import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { users } from '../db/schema';

/** Same rule as the users_username_check constraint. */
export const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

/** Turns any string (e-mail local part, display name) into a valid username, keeping room for a suffix. */
export function usernameBase(source: string): string {
	const base = source
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '') // strip accents
		.replace(/[^a-zA-Z0-9_]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 24);
	return (base || 'user').padEnd(3, '_');
}

/** First free username among base, base_2, base_3… */
export async function availableUsername(db: Pick<Db, '$count'>, base: string): Promise<string> {
	for (let i = 1; ; i++) {
		const candidate = i === 1 ? base : `${base}_${i}`;
		if ((await db.$count(users, eq(users.username, candidate))) === 0) return candidate;
	}
}
