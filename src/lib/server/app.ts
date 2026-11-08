// App-side singletons (SvelteKit only: variables come from src/env.ts, validated at startup).
// The worker builds its own instances from process.env.
import {
	BETTER_AUTH_SECRET,
	BETTER_AUTH_URL,
	DATABASE_URL,
	GITHUB_CLIENT_ID,
	GITHUB_CLIENT_SECRET,
	GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET
} from '$app/env/private';
import { PgBoss } from 'pg-boss';
import { createAuth } from './auth';
import { createDb } from './db';

const oauth = (clientId?: string, clientSecret?: string) =>
	clientId && clientSecret ? { clientId, clientSecret } : undefined;

export const db = createDb(DATABASE_URL);

export const auth = createAuth(db, {
	secret: BETTER_AUTH_SECRET,
	baseURL: BETTER_AUTH_URL,
	google: oauth(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET),
	github: oauth(GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET)
});

/** Social providers configured in the environment, for the sign-in buttons. */
export const socialProviders = (['google', 'github'] as const).filter(
	(p) => p in auth.options.socialProviders
);

// The app only sends jobs: maintenance, scheduling and pg-boss migrations belong to the worker.
const boss = new PgBoss({
	connectionString: DATABASE_URL,
	max: 2,
	supervise: false,
	schedule: false,
	migrate: false
});
boss.on('error', (err) => console.error('[app] pg-boss error', err));
let started: Promise<unknown> | undefined;

/** Started on first use, so the app boots even when the job tables do not exist yet. */
export async function getBoss(): Promise<PgBoss> {
	started ??= boss.start().catch((err) => {
		started = undefined; // retry on next call
		throw err;
	});
	await started;
	return boss;
}
