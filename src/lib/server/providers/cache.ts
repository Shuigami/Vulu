import { eq, gt, lt, and } from 'drizzle-orm';
import type { Db } from '../db';
import { providerCache } from '../db/schema';

export const DAY = 24 * 60 * 60;

/** Returns the cached value for `key`, or computes, stores and returns it. Null results are not cached. */
export async function cached<T>(
	db: Db,
	key: string,
	ttlSeconds: number,
	compute: () => Promise<T | null>
): Promise<T | null> {
	const [hit] = await db
		.select({ value: providerCache.value })
		.from(providerCache)
		.where(and(eq(providerCache.key, key), gt(providerCache.expiresAt, new Date())));
	if (hit) return hit.value as T;

	const value = await compute();
	if (value === null) return null;
	const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
	await db
		.insert(providerCache)
		.values({ key, value, expiresAt })
		.onConflictDoUpdate({ target: providerCache.key, set: { value, expiresAt } });
	return value;
}

/** Deletes expired entries; returns how many were removed. */
export async function purgeExpired(db: Db): Promise<number> {
	const rows = await db
		.delete(providerCache)
		.where(lt(providerCache.expiresAt, new Date()))
		.returning({ key: providerCache.key });
	return rows.length;
}
