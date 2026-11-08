<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Poster from '#lib/components/Poster.svelte';
	import { MEDIA_TYPES, typeLabel, typePlural } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let adding = $state<string | null>(null);

	const filterHref = (type?: string) =>
		`${resolve('search')}?${new URLSearchParams({ q: data.q, ...(type && { type }) })}`;
	const providerName = { tmdb: 'TMDB', anilist: 'AniList', openlibrary: 'Open Library' } as Record<
		string,
		string
	>;
</script>

<svelte:head><title>{data.q ? `${data.q} · Recherche` : 'Recherche'} · Vulu</title></svelte:head>

<h1 class="text-xl font-semibold">Recherche</h1>

{#if !data.q}
	<p class="mt-2 text-gray-600">Tape un titre dans la barre de recherche, en haut.</p>
{:else}
	<!-- eslint-disable svelte/no-navigation-without-resolve -- filterHref() builds on resolve() -->
	<nav class="mt-3 flex flex-wrap gap-2 text-sm" aria-label="Filtrer par type">
		{#each [undefined, ...MEDIA_TYPES] as type (type ?? 'all')}
			<a
				href={filterHref(type)}
				class="rounded-full border px-3 py-1 {data.type === type
					? 'border-gray-900 bg-gray-900 text-white'
					: 'border-gray-300 text-gray-700 hover:border-gray-500'}"
				aria-current={data.type === type ? 'page' : undefined}
			>
				{type ? typePlural[type] : 'Tous'}
			</a>
		{/each}
	</nav>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->

	{#if form?.importError}<p role="alert" class="mt-3 text-sm text-red-600">
			{form.importError}
		</p>{/if}

	<ul class="mt-4 divide-y divide-gray-100">
		{#each data.local as m (m.id)}
			<li class="flex items-center gap-3 py-2">
				<Poster src={m.posterUrl} title={m.title} />
				<div class="min-w-0 flex-1">
					<a
						href={resolve('/(app)/media/[id]', { id: String(m.id) })}
						class="font-medium hover:underline">{m.title}</a
					>
					<p class="text-sm text-gray-500">{typeLabel[m.type]}{m.year ? ` · ${m.year}` : ''}</p>
				</div>
				{#if data.inLibrary.includes(m.id)}
					<span class="text-sm text-gray-500">Dans ta bibliothèque</span>
				{:else}
					<form method="post" action="?/add" use:enhance>
						<input type="hidden" name="mediaId" value={m.id} />
						<button class="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
							>Ajouter</button
						>
					</form>
				{/if}
			</li>
		{/each}
	</ul>

	{#if data.remote}
		{#await data.remote}
			<p class="mt-4 text-sm text-gray-500" aria-live="polite">Recherche chez les fournisseurs…</p>
		{:then remote}
			{#if remote.results.length}
				<h2 class="mt-6 text-sm font-medium text-gray-500">Pas encore dans le catalogue</h2>
				<ul class="mt-2 divide-y divide-gray-100">
					{#each remote.results as r (`${r.provider}:${r.externalId}`)}
						{@const key = `${r.provider}:${r.externalId}`}
						<li class="flex items-center gap-3 py-2">
							<Poster src={r.posterUrl} title={r.title} />
							<div class="min-w-0 flex-1">
								<p class="font-medium">{r.title}</p>
								<p class="text-sm text-gray-500">
									{typeLabel[r.type]}{r.year ? ` · ${r.year}` : ''} · {providerName[r.provider]}
								</p>
							</div>
							<form
								method="post"
								action="?/import"
								use:enhance={() => {
									adding = key;
									return async ({ update }) => {
										await update();
										adding = null;
									};
								}}
							>
								<input type="hidden" name="type" value={r.type} />
								<input type="hidden" name="provider" value={r.provider} />
								<input type="hidden" name="externalId" value={r.externalId} />
								<button
									disabled={adding !== null}
									class="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
								>
									{adding === key ? 'Ajout…' : 'Ajouter'}
								</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
			{#if remote.failed}
				<p class="mt-4 text-sm text-amber-700">
					Certains fournisseurs n’ont pas répondu : des résultats peuvent manquer.
				</p>
			{/if}
			{#if !data.local.length && !remote.results.length && !remote.failed}
				<p class="mt-4 text-gray-600">Aucun résultat pour « {data.q} ».</p>
			{/if}
		{/await}
	{/if}
{/if}
