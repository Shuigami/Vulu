// App environment variables, validated when the app starts (SvelteKit 3).
// The worker and scripts read process.env directly.
import { defineEnvVars } from '@sveltejs/kit/env';

const required = (name: string) => (value: string | undefined) => {
	if (!value) throw new Error(`${name} is not set`);
	return value;
};
const optional = (value: string | undefined) => value || undefined;

export const variables = defineEnvVars({
	DATABASE_URL: { schema: required('DATABASE_URL') },
	BETTER_AUTH_SECRET: {
		schema: (value) => {
			if (!value || value.length < 32)
				throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');
			return value;
		}
	},
	BETTER_AUTH_URL: { schema: required('BETTER_AUTH_URL') },
	GOOGLE_CLIENT_ID: { schema: optional },
	GOOGLE_CLIENT_SECRET: { schema: optional },
	GITHUB_CLIENT_ID: { schema: optional },
	GITHUB_CLIENT_SECRET: { schema: optional }
});
