<script lang="ts">
	import { authClient } from '#lib/auth-client.ts';

	type Provider = 'google' | 'github';
	let { providers, redirectTo }: { providers: readonly Provider[]; redirectTo: string } = $props();

	const labels: Record<Provider, string> = { google: 'Google', github: 'GitHub' };

	function signIn(provider: Provider) {
		// Errors (e.g. NOT_INVITED) come back as ?error=… on the login page.
		return authClient.signIn.social({
			provider,
			callbackURL: redirectTo,
			errorCallbackURL: '/login'
		});
	}
</script>

{#if providers.length > 0}
	<div class="mt-6 flex flex-col gap-2">
		<p class="text-center text-sm text-gray-500">ou</p>
		{#each providers as provider (provider)}
			<button
				type="button"
				class="rounded border border-gray-300 px-3 py-2 hover:bg-gray-50"
				onclick={() => signIn(provider)}
			>
				Continuer avec {labels[provider]}
			</button>
		{/each}
	</div>
{/if}
