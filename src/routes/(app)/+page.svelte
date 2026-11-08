<script lang="ts">
	import { enhance } from '$app/forms';
	import EntryRow from '#lib/components/EntryRow.svelte';
	import { unitLabel } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let pending = $state<number | null>(null);
	const singular = { épisodes: 'épisode', chapitres: 'chapitre', pages: 'page' } as Record<
		string,
		string
	>;
</script>

<svelte:head><title>En cours · Vulu</title></svelte:head>

<h1 class="text-xl font-semibold">En cours</h1>

{#if data.entries.length}
	<ul class="mt-4 divide-y divide-gray-100">
		{#each data.entries as e (e.id)}
			{@const unit = unitLabel[e.type]}
			<li class="flex items-center gap-3">
				<div class="min-w-0 flex-1"><EntryRow entry={e} scale={data.user.ratingScale} /></div>
				{#if unit}
					<form
						method="post"
						action="?/increment"
						use:enhance={() => {
							pending = e.id;
							return async ({ update }) => {
								await update();
								pending = null;
							};
						}}
					>
						<input type="hidden" name="entryId" value={e.id} />
						<button
							disabled={pending === e.id}
							aria-label="+1 {singular[unit]} pour {e.title}"
							class="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
						>
							+1
						</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{:else}
	<p class="mt-2 text-gray-600">
		Rien en cours. Cherche une œuvre, ajoute-la, puis passe-la « En cours » ou avance sa
		progression.
	</p>
{/if}
