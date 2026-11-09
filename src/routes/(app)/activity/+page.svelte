<script lang="ts">
	import { resolve } from '$app/paths';
	import ActivityFeed from '#lib/components/ActivityFeed.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>Activité · Vulu</title></svelte:head>

<div class="flex flex-col gap-7">
	<div>
		<p class="eyebrow">Tes abonnements</p>
		<h1 class="mt-1.5 h1">Activité</h1>
	</div>
	{#if data.items.length}
		<ActivityFeed items={data.items} scale={data.user.ratingScale} />
		{#if data.next}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- query on a resolved path -->
			<a
				href="{resolve('activity')}?before={encodeURIComponent(data.next)}"
				class="btn-ghost self-start">Voir plus</a
			>
		{/if}
	{:else}
		<p class="text-muted">
			Rien ici pour l’instant. Cherche des membres depuis la barre de recherche et abonne-toi pour
			voir ce qu’ils regardent et lisent.
		</p>
	{/if}
</div>
