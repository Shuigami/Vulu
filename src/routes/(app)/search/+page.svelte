<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Avatar from '#lib/components/Avatar.svelte';
	import Poster from '#lib/components/Poster.svelte';
	import TypeTag from '#lib/components/TypeTag.svelte';
	import { MEDIA_TYPES, typePlural } from '#lib/labels.ts';
	import { opening } from '#lib/opening.svelte.ts';
	import { byRelevance, relevance } from '#lib/relevance.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let adding = $state<string | null>(null);

	const filterHref = (type?: string) =>
		`${resolve('search')}?${new URLSearchParams({ q: data.q, ...(type && { type }) })}`;
	// Provider results stream in per type, below the catalogue ones. Each batch is added in arrival
	// order (most relevant first within it), so what is on screen never moves.
	type Part = Awaited<NonNullable<typeof data.remote>[number]>;
	let parts = $state<Part[]>([]);
	$effect(() => {
		const pending = data.remote;
		parts = [];
		for (const p of pending ?? [])
			p.then((part) => {
				if (data.remote === pending) parts.push(part);
			});
	});
	const searching = $derived(!!data.remote && parts.length < data.remote.length);
	// Open Library is often too slow: on "Tous", missing books alone are not worth a warning
	const failed = $derived(
		parts.some((p) => p.failed && (p.type !== 'book' || data.type === 'book'))
	);
	// Weak catalogue matches (no title starting with the query) go after the provider results, at
	// the bottom, so a stray local title does not sit above the work searched for.
	const local = $derived(
		byRelevance(
			data.q,
			data.local.map((m) => ({ ...m, provider: null, externalId: null, key: `local:${m.id}` }))
		)
	);
	const strong = $derived(local.filter((m) => relevance(data.q, m.title) >= 2));
	const results = $derived([
		...strong,
		...parts.flatMap((p) =>
			byRelevance(
				data.q,
				p.results.map((r) => ({ ...r, id: null, key: `${r.provider}:${r.externalId}` }))
			)
		),
		...local.slice(strong.length)
	]);
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
						<!-- The title's ::after covers the card, so the whole card opens the work -->
						<li
							class="relative flex items-center gap-4 card rounded-[14px] py-2.5 pr-3.5 pl-2.5 hover:border-muted"
						>
							<Poster src={r.posterUrl} title={r.title} type={r.type} class="w-13 rounded-lg" />
							<div class="min-w-0 flex-1">
								{#if r.id}
									<a
										href={resolve('/(app)/media/[id]', { id: String(r.id) })}
										class="text-base font-semibold text-ink no-underline after:absolute after:inset-0 after:rounded-[14px] hover:underline"
										>{r.title}</a
									>
								{:else}
									<!-- Not in the catalogue yet: imported without adding, then opened -->
									<form
										method="post"
										action="?/open"
										use:enhance={() => {
											opening.active = true;
											return async ({ update }) => {
												await update();
												opening.active = false;
											};
										}}
									>
										<input type="hidden" name="type" value={r.type} />
										<input type="hidden" name="provider" value={r.provider} />
										<input type="hidden" name="externalId" value={r.externalId} />
										<button
											class="cursor-pointer text-left text-base font-semibold text-ink after:absolute after:inset-0 after:rounded-[14px] hover:underline"
											>{r.title}</button
										>
									</form>
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
									class="relative"
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
			{/if}
			{#if !searching && failed}
				<p class="text-sm text-accent-ink">
					Certains fournisseurs n’ont pas répondu : des résultats peuvent manquer.
				</p>
			{/if}
			{#if !searching && !results.length}
				<p class="text-muted">Aucun résultat pour « {data.q} ».</p>
			{/if}
		</section>
	{/if}
</div>
