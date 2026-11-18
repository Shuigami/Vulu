<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Avatar from '#lib/components/Avatar.svelte';
	import Poster from '#lib/components/Poster.svelte';
	import TypeTag from '#lib/components/TypeTag.svelte';
	import { MEDIA_TYPES, typePlural } from '#lib/labels.ts';
	import { byRelevance } from '#lib/relevance.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let adding = $state<string | null>(null);

	const filterHref = (type?: string) =>
		`${resolve('search')}?${new URLSearchParams({ q: data.q, ...(type && { type }) })}`;
	// Provider results arrive later (streamed); both lists then show as one, most relevant first
	type Remote = Awaited<NonNullable<typeof data.remote>>;
	let remote = $state<Remote | null>(null);
	$effect(() => {
		const pending = data.remote;
		remote = null;
		pending?.then((r) => {
			if (data.remote === pending) remote = r;
		});
	});
	const searching = $derived(!!data.remote && !remote);
	const results = $derived(
		byRelevance(data.q, [
			...data.local.map((m) => ({ ...m, provider: null, externalId: null, key: `local:${m.id}` })),
			...(remote?.results ?? []).map((r) => ({
				...r,
				id: null,
				key: `${r.provider}:${r.externalId}`
			}))
		])
	);
	// Per-type counts, only meaningful on "Tous" (a type filter searches that type alone)
	const count = (type?: string) =>
		data.type ? null : type ? results.filter((r) => r.type === type).length : results.length;
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
						{#if count(type) !== null}<span class="font-medium tabular-nums opacity-60"
								>{count(type)}</span
							>{/if}
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

		<section aria-labelledby="results" class="flex flex-col gap-2">
			<h2 id="results" class="sr-only">Œuvres</h2>
			{#if results.length}
				<ul class="flex flex-col gap-2">
					{#each results as r (r.key)}
						<li class="flex items-center gap-4 card rounded-[14px] py-2.5 pr-3.5 pl-2.5">
							<Poster src={r.posterUrl} title={r.title} type={r.type} class="w-13 rounded-lg" />
							<div class="min-w-0 flex-1">
								{#if r.id}
									<a
										href={resolve('/(app)/media/[id]', { id: String(r.id) })}
										class="text-base font-semibold text-ink no-underline hover:underline"
										>{r.title}</a
									>
								{:else}
									<p class="text-base font-semibold">{r.title}</p>
								{/if}
								<p class="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
									<TypeTag type={r.type} />{r.year ?? ''}
								</p>
								{#if r.id && data.inLibrary.includes(r.id)}
									<p class="mt-1 text-[13px] font-semibold text-success">Dans ta bibliothèque</p>
								{/if}
							</div>
							{#if !(r.id && data.inLibrary.includes(r.id))}
								<form
									method="post"
									action={r.id ? '?/add' : '?/import'}
									use:enhance={() => {
										adding = r.key;
										return async ({ update }) => {
											await update();
											adding = null;
										};
									}}
								>
									{#if r.id}
										<input type="hidden" name="mediaId" value={r.id} />
									{:else}
										<input type="hidden" name="type" value={r.type} />
										<input type="hidden" name="provider" value={r.provider} />
										<input type="hidden" name="externalId" value={r.externalId} />
									{/if}
									<button
										disabled={adding !== null}
										aria-label="Ajouter {r.title} à ma bibliothèque"
										title="Ajouter à ma bibliothèque"
										class="btn-ghost size-11 rounded-full px-0"
										>{#if adding === r.key}<span class="text-xs">…</span>{:else}<svg
												aria-hidden="true"
												width="20"
												height="20"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2.2"
												stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg
											>{/if}</button
									>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			{#if searching}
				<p class="text-sm text-muted" aria-live="polite">Recherche chez les fournisseurs…</p>
			{:else if remote?.failed}
				<p class="text-sm text-accent-ink">
					Certains fournisseurs n’ont pas répondu : des résultats peuvent manquer.
				</p>
			{:else if !results.length}
				<p class="text-muted">Aucun résultat pour « {data.q} ».</p>
			{/if}
		</section>
	{/if}
</div>
