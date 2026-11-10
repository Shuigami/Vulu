// Better Auth setup, mapped onto the app's own `users` table (see docs/schema.sql).
// Free of $env so tests can build an instance; the app instance lives in src/lib/server/app.ts.
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { accounts, invites, sessions, users, verifications } from '../db/schema';
import { createMailer, resetPasswordMail, type SendMail } from '../mail';
import { availableUsername, USERNAME_RE, usernameBase } from './username';

type OAuthCredentials = { clientId: string; clientSecret: string };

export type AuthConfig = {
	secret: string;
	baseURL: string;
	google?: OAuthCredentials;
	github?: OAuthCredentials;
	/** Defaults to printing e-mails to the console. */
	sendMail?: SendMail;
};

/** Error codes returned to the client, translated in src/lib/auth-errors.ts. */
export const AUTH_ERRORS = {
	NOT_INVITED: 'NOT_INVITED',
	INVALID_USERNAME: 'INVALID_USERNAME',
	USERNAME_TAKEN: 'USERNAME_TAKEN'
} as const;

export function createAuth(db: Db, config: AuthConfig) {
	const sendMail = config.sendMail ?? createMailer();
	return betterAuth({
		secret: config.secret,
		baseURL: config.baseURL,
		database: drizzleAdapter(db, {
			provider: 'pg',
			schema: { users, sessions, accounts, verifications }
		}),
		user: {
			modelName: 'users',
			fields: { name: 'displayName', image: 'avatarUrl' },
			additionalFields: {
				username: { type: 'string', required: false, input: true },
				// Read-only here: exposed in the session to display scores in the user's scale
				ratingScale: { type: 'number', required: false, input: false }
			}
		},
		session: { modelName: 'sessions' },
		account: { modelName: 'accounts' },
		verification: { modelName: 'verifications' },
		advanced: { database: { generateId: 'uuid' } },
		// shortcut: no e-mail verification yet, only password reset sends e-mails.
		emailAndPassword: {
			enabled: true,
			resetPasswordTokenExpiresIn: 60 * 60,
			revokeSessionsOnPasswordReset: true,
			sendResetPassword: async ({ user, url }) => {
				// Not awaited: answer time must not reveal whether the address has an account
				void sendMail(resetPasswordMail(user.email, user.name || 'toi', url)).catch((err) =>
					console.error('[auth] reset e-mail failed', err)
				);
			}
		},
		socialProviders: {
			...(config.google && { google: config.google }),
			...(config.github && { github: config.github })
		},
		databaseHooks: {
			user: {
				create: {
					// Runs for every sign-up method (password, Google, GitHub).
					before: async (user) => {
						const email = user.email.toLowerCase();
						if ((await db.$count(invites, eq(invites.email, email))) === 0) {
							throw new APIError('FORBIDDEN', {
								code: AUTH_ERRORS.NOT_INVITED,
								message: 'This e-mail address has not been invited'
							});
						}

						const requested = (user as { username?: unknown }).username;
						let username: string;
						if (typeof requested === 'string' && requested !== '') {
							if (!USERNAME_RE.test(requested)) {
								throw new APIError('BAD_REQUEST', {
									code: AUTH_ERRORS.INVALID_USERNAME,
									message: 'Invalid username'
								});
							}
							if ((await db.$count(users, eq(users.username, requested))) > 0) {
								throw new APIError('BAD_REQUEST', {
									code: AUTH_ERRORS.USERNAME_TAKEN,
									message: 'Username already taken'
								});
							}
							username = requested;
						} else {
							// OAuth sign-up: no form, derive it from the e-mail (editable later).
							username = await availableUsername(db, usernameBase(email.split('@')[0]));
						}
						return { data: { ...user, username } };
					},
					after: async (user) => {
						await db
							.update(invites)
							.set({ usedAt: new Date() })
							.where(eq(invites.email, user.email.toLowerCase()));
					}
				}
			}
		}
	});
}

export type Auth = ReturnType<typeof createAuth>;
export type SessionUser = Auth['$Infer']['Session']['user'];
export type Session = Auth['$Infer']['Session']['session'];
