<script lang="ts">
	import { resolve } from '$app/paths';
	import Poster from '#lib/components/Poster.svelte';
	import { typeLabel } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>Calendrier · Vulu</title></svelte:head>

<h1 class="text-xl font-semibold">Calendrier</h1>
<p class="mt-1 text-sm text-gray-500">
	Prochains épisodes des séries et anime que tu suis, sur {data.horizon} jours (heure de Paris).
</p>

{#if data.days.length}
	{#each data.days as day (day.key)}
		<section class="mt-6" aria-labelledby="day-{day.key}">
			<h2 id="day-{day.key}" class="text-sm font-medium text-gray-700 first-letter:uppercase">
				{day.label}
			</h2>
			<ul class="mt-2 divide-y divide-gray-100">
				{#each day.items as item (item.key)}
					<li class="flex items-center gap-3 py-2">
						<Poster src={item.posterUrl} title={item.mediaTitle} />
						<div class="min-w-0 flex-1">
							<a
								href={resolve('/(app)/media/[id]', { id: String(item.mediaId) })}
								class="font-medium hover:underline">{item.mediaTitle}</a
							>
							<p class="text-sm text-gray-500">
								{item.episode}{item.episodeTitle ? ` · ${item.episodeTitle}` : ''} · {typeLabel[
									item.type
								]}
							</p>
						</div>
						{#if item.time}<span class="text-sm text-gray-600 tabular-nums">{item.time}</span>{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/each}
{:else}
	<p class="mt-4 text-gray-600">
		Aucun épisode prévu. Ajoute des séries ou des anime en cours de diffusion à ta bibliothèque :
		leurs prochains épisodes apparaîtront ici.
	</p>
{/if}
