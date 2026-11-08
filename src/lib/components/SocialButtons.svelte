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
	<div class="flex flex-col gap-2.5">
		<p class="flex items-center gap-3 text-[13px] text-muted">
			<span class="h-px flex-1 bg-line"></span>ou<span class="h-px flex-1 bg-line"></span>
		</p>
		{#each providers as provider (provider)}
			<button
				type="button"
				class="btn border border-line text-ink hover:border-muted"
				onclick={() => signIn(provider)}
			>
				Continuer avec {labels[provider]}
			</button>
		{/each}
	</div>
{/if}
