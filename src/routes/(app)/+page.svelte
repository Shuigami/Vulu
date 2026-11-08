<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>Vulu</title></svelte:head>

<h1 class="text-xl font-semibold">Bonjour {data.user.displayName || data.user.username}</h1>
<p class="mt-2 text-gray-600">Ta bibliothèque arrive bientôt.</p>
