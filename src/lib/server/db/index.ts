// Shared by the SvelteKit app and the worker: callers pass the URL so this module
// stays free of $env (SvelteKit-only) and process.env (worker-only) concerns.
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export function createDb(url: string) {
	return drizzle(url, { schema, casing: 'snake_case' });
}

export type Db = ReturnType<typeof createDb>;
