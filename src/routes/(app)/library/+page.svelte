<script lang="ts">
	import { resolve } from '$app/paths';
	import EntryRow from '#lib/components/EntryRow.svelte';
	import { ENTRY_STATUSES, MEDIA_TYPES, statusLabel, typePlural } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const href = (change: { type?: string | null; status?: string | null }) => {
		const type = 'type' in change ? change.type : data.type;
		const status = 'status' in change ? change.status : data.status;
		const query = [type && `type=${type}`, status && `status=${status}`].filter(Boolean).join('&');
		return `${resolve('library')}${query ? `?${query}` : ''}`;
	};
	const chip = (active: boolean) =>
		`rounded-full border px-3 py-1 ${active ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 text-gray-700 hover:border-gray-500'}`;
</script>

<svelte:head><title>Bibliothèque · Vulu</title></svelte:head>

<h1 class="text-xl font-semibold">Bibliothèque</h1>

<!-- eslint-disable svelte/no-navigation-without-resolve -- href() builds on resolve() -->
<nav class="mt-3 flex flex-wrap gap-2 text-sm" aria-label="Filtrer par type">
	<a href={href({ type: null })} class={chip(!data.type)}>Tous</a>
	{#each MEDIA_TYPES as t (t)}
		<a href={href({ type: t })} class={chip(data.type === t)}>{typePlural[t]}</a>
	{/each}
</nav>
<nav class="mt-2 flex flex-wrap gap-2 text-sm" aria-label="Filtrer par statut">
	<a href={href({ status: null })} class={chip(!data.status)}>Tous les statuts</a>
	{#each ENTRY_STATUSES as s (s)}
		<a href={href({ status: s })} class={chip(data.status === s)}>{statusLabel[s]}</a>
	{/each}
</nav>
<!-- eslint-enable svelte/no-navigation-without-resolve -->

{#if data.entries.length}
	<ul class="mt-4 divide-y divide-gray-100">
		{#each data.entries as e (e.id)}
			<li><EntryRow entry={e} scale={data.user.ratingScale} /></li>
		{/each}
	</ul>
{:else}
	<p class="mt-4 text-gray-600">
		Rien ici pour l’instant. Utilise la recherche, en haut, pour ajouter une œuvre.
	</p>
{/if}
