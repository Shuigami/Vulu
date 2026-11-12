// Better Auth setup, mapped onto the app's own `users` table (see docs/schema.sql).
// Free of $env so tests can build an instance; the app instance lives in src/lib/server/app.ts.
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db';
import { accounts, sessions, users, verifications } from '../db/schema';
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
		account: {
			modelName: 'accounts',
			// Signing in with Google (or GitHub, verified e-mail) on an existing password account links
			// it. Local e-mails are not verified, so the password is dropped on link (account hook below).
			accountLinking: { trustedProviders: ['google'], requireLocalEmailVerified: false }
		},
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
			account: {
				create: {
					// The provider proved the e-mail is theirs: whoever set the password (maybe someone who
					// signed up with this address first) loses access. "Mot de passe oublié" sets a new one.
					after: async (account) => {
						if (account.providerId === 'credential') return;
						const removed = await db
							.delete(accounts)
							.where(
								and(eq(accounts.userId, account.userId), eq(accounts.providerId, 'credential'))
							)
							.returning({ id: accounts.id });
						// Runs before the new sign-in session is created
						if (removed.length)
							await db.delete(sessions).where(eq(sessions.userId, account.userId));
					}
				}
			},
			user: {
				create: {
					// Runs for every sign-up method (password, Google, GitHub).
					before: async (user) => {
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
							username = await availableUsername(
								db,
								usernameBase(user.email.toLowerCase().split('@')[0])
							);
						}
						return { data: { ...user, username } };
					}
				}
			}
		}
	});
}

export type Auth = ReturnType<typeof createAuth>;
export type SessionUser = Auth['$Infer']['Session']['user'];
export type Session = Auth['$Infer']['Session']['session'];
