<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '#lib/auth-client.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	async function signOut() {
		await authClient.signOut();
		await invalidateAll();
		await goto(resolve('login'));
	}
</script>

<header class="flex items-center justify-between border-b border-gray-200 px-4 py-3">
	<a href={resolve('')} class="font-semibold">Vulu</a>
	<div class="flex items-center gap-3 text-sm">
		<span>{data.user.displayName || data.user.username}</span>
		<button type="button" class="text-gray-600 underline hover:text-gray-900" onclick={signOut}>
			Se déconnecter
		</button>
	</div>
</header>

<main class="mx-auto max-w-3xl p-4">
	{@render children()}
</main>
