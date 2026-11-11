<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Avatar from '#lib/components/Avatar.svelte';
	import Poster from '#lib/components/Poster.svelte';
	import TypeTag from '#lib/components/TypeTag.svelte';
	import { MEDIA_TYPES, typePlural } from '#lib/labels.ts';
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

<div class="mx-auto flex max-w-3xl flex-col gap-7">
	{#if !data.q}
		<h1 class="sr-only">Recherche</h1>
		<p class="text-muted">Tape un titre dans la barre de recherche, en haut.</p>
	{:else}
		<div class="flex flex-col gap-4">
			<h1
				class="font-display text-[34px] leading-tight font-extrabold tracking-tight sm:text-[44px]"
			>
				Résultats pour <span class="text-accent-ink">« {data.q} »</span>
			</h1>
			<!-- eslint-disable svelte/no-navigation-without-resolve -- filterHref() builds on resolve() -->
			<nav class="scroll-row" aria-label="Filtrer par type">
				{#each [undefined, ...MEDIA_TYPES] as type (type ?? 'all')}
					<a
						href={filterHref(type)}
						class={data.type === type ? 'chip-on' : 'chip'}
						aria-current={data.type === type ? 'page' : undefined}
					>
						{type ? typePlural[type] : 'Tous'}
					</a>
				{/each}
			</nav>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</div>

		{#if form?.importError}<p role="alert" class="text-sm text-danger">{form.importError}</p>{/if}

		{#if data.members.length}
			<section aria-labelledby="members" class="flex flex-col gap-2">
				<h2 id="members" class="eyebrow">Membres</h2>
				<ul class="flex flex-wrap gap-2">
					{#each data.members as u (u.id)}
						<li>
							<a
								href={resolve('/(app)/u/[username]', { username: u.username })}
								class="flex items-center gap-2.5 card rounded-full py-1.5 pr-4 pl-1.5 text-sm text-ink no-underline hover:border-muted"
							>
								<Avatar src={u.avatarUrl} name={u.displayName || u.username} class="size-8" />
								<span class="font-semibold">{u.displayName || u.username}</span>
								<span class="text-muted">@{u.username}</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if data.local.length}
			<section aria-labelledby="local" class="flex flex-col gap-2">
				<h2 id="local" class="eyebrow">Dans le catalogue</h2>
				<ul class="flex flex-col gap-2">
					{#each data.local as m (m.id)}
						<li class="flex items-center gap-4 card rounded-[14px] py-2.5 pr-3.5 pl-2.5">
							<Poster src={m.posterUrl} title={m.title} type={m.type} class="w-13 rounded-lg" />
							<div class="min-w-0 flex-1">
								<a
									href={resolve('/(app)/media/[id]', { id: String(m.id) })}
									class="text-base font-semibold text-ink no-underline hover:underline">{m.title}</a
								>
								<p class="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
									<TypeTag type={m.type} />{m.year ?? ''}
								</p>
							</div>
							{#if data.inLibrary.includes(m.id)}
								<span class="text-[13px] font-semibold text-success">Dans ta bibliothèque</span>
							{:else}
								<form method="post" action="?/add" use:enhance>
									<input type="hidden" name="mediaId" value={m.id} />
									<button class="btn-ghost text-sm">+ Ajouter</button>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if data.remote}
			{#await data.remote}
				<p class="text-sm text-muted" aria-live="polite">Recherche chez les fournisseurs…</p>
			{:then remote}
				{#if remote.results.length}
					<section aria-labelledby="remote" class="flex flex-col gap-2">
						<h2 id="remote" class="eyebrow">Pas encore dans le catalogue</h2>
						<ul class="flex flex-col gap-2">
							{#each remote.results as r (`${r.provider}:${r.externalId}`)}
								{@const key = `${r.provider}:${r.externalId}`}
								<li
									class="flex items-center gap-4 rounded-[14px] border border-dashed border-line py-2.5 pr-3.5 pl-2.5"
								>
									<Poster src={r.posterUrl} title={r.title} type={r.type} class="w-13 rounded-lg" />
									<div class="min-w-0 flex-1">
										<p class="text-base font-semibold">{r.title}</p>
										<p class="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
											<TypeTag type={r.type} />{r.year ? `${r.year} · ` : ''}{providerName[
												r.provider
											]}
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
										<button disabled={adding !== null} class="btn-ghost text-sm">
											{adding === key ? 'Ajout…' : '+ Ajouter'}
										</button>
									</form>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
				{#if remote.failed}
					<p class="text-sm text-accent-ink">
						Certains fournisseurs n’ont pas répondu : des résultats peuvent manquer.
					</p>
				{/if}
				{#if !data.local.length && !remote.results.length && !remote.failed}
					<p class="text-muted">Aucun résultat pour « {data.q} ».</p>
				{/if}
			{/await}
		{/if}
	{/if}
</div>
