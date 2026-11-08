import { createAuthClient } from 'better-auth/svelte';
import { inferAdditionalFields } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
	plugins: [inferAdditionalFields({ user: { username: { type: 'string', required: false } } })]
});
