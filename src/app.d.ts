// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Session, SessionUser } from '#lib/server/auth/index.ts';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: SessionUser | null;
			session: Session | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
