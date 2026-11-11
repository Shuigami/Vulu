<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from '#lib/toast.svelte.ts';
	import { resolve } from '$app/paths';
	import Poster from '#lib/components/Poster.svelte';
	import StartHere from '#lib/components/StartHere.svelte';
	import {
		ENTRY_STATUSES,
		MEDIA_TYPES,
		statusLabel,
		toScale,
		typeLabel,
		typePlural,
		unitLabel
	} from '#lib/labels.ts';
	import type { PageProps } from './$types';

	const typeDot = {
		movie: 'bg-movie',
		tv: 'bg-tv',
		anime: 'bg-anime',
		manga: 'bg-manga',
		book: 'bg-book'
	} as const;

	let { data }: PageProps = $props();
	// +1 from the grid updates the card in place: reloading would move it to the front (recent sort)
	let bumped = $state<Record<number, number>>({});
	let pending = $state<number | null>(null);

	type Query = { type?: string | null; status?: string | null; favorite?: boolean; page?: number };
	// Filters keep the search and the sort; changing a filter goes back to page 1
	const href = (change: Query) => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and read once, not state
		const params = new URLSearchParams();
		const type = 'type' in change ? change.type : data.type;
		const status = 'status' in change ? change.status : data.status;
		const favorite = 'favorite' in change ? change.favorite : data.favorite;
		if (type) params.set('type', type);
		if (status) params.set('status', status);
		if (favorite) params.set('fav', '');
		if (data.q) params.set('q', data.q);
		if (data.sort !== 'updated') params.set('sort', data.sort);
		if (change.page && change.page > 1) params.set('page', String(change.page));
		const query = params.toString();
		return `${resolve('library')}${query ? `?${query}` : ''}`;
	};
	const sorts = [
		{ value: 'updated', label: 'Activité récente' },
		{ value: 'added', label: 'Date d’ajout' },
		{ value: 'title', label: 'Titre' },
		{ value: 'score', label: 'Note' }
	];
	const tab = (active: boolean) =>
		`border-b-2 px-3.5 py-2.5 text-sm no-underline ${active ? 'border-accent font-semibold text-ink' : 'border-transparent text-muted hover:text-ink'}`;
	const scale = $derived(data.user.ratingScale);
	const allCount = $derived(Object.values(data.counts).reduce((a, b) => a + b, 0));
</script>

<svelte:head><title>Bibliothèque · Vulu</title></svelte:head>

<div class="flex flex-col gap-7">
	<h1 class="h1">
		Bibliothèque <span class="text-[32px] font-medium text-muted">{data.total}</span>
	</h1>

	<!-- eslint-disable svelte/no-navigation-without-resolve -- href() builds on resolve() -->
	<div class="flex flex-col gap-3">
		<div class="scroll-row items-center justify-between">
			<nav class="flex gap-2 md:flex-wrap" aria-label="Filtrer par type">
				<a
					href={href({ type: null })}
					class={!data.type ? 'chip-on' : 'chip'}
					aria-current={!data.type ? 'page' : undefined}>Tous</a
				>
				{#each MEDIA_TYPES as t (t)}
					<a
						href={href({ type: t })}
						class={data.type === t ? 'chip-on' : 'chip'}
						aria-current={data.type === t ? 'page' : undefined}>{typePlural[t]}</a
					>
				{/each}
			</nav>
			<a
				href={href({ favorite: !data.favorite })}
				class={data.favorite ? 'chip-on' : 'chip'}
				aria-current={data.favorite ? 'page' : undefined}
				><svg
					aria-hidden="true"
					width="15"
					height="15"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
					class={data.favorite ? 'fill-current text-anime' : 'fill-none'}
					><path
						d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"
					></path></svg
				>Favoris</a
			>
		</div>
		<!-- Inset line rather than a border: the scrolling row would clip tabs overlapping it -->
		<nav
			class="scroll-row gap-1 shadow-[inset_0_-1px_0_var(--c-line)]"
			aria-label="Filtrer par statut"
		>
			<a
				href={href({ status: null })}
				class={tab(!data.status)}
				aria-current={!data.status ? 'page' : undefined}
				>Tous les statuts <span class="ml-1 text-muted tabular-nums">{allCount}</span></a
			>
			{#each ENTRY_STATUSES as s (s)}
				<a
					href={href({ status: s })}
					class={tab(data.status === s)}
					aria-current={data.status === s ? 'page' : undefined}
					>{statusLabel[s]}
					<span class="ml-1 text-muted tabular-nums">{data.counts[s] ?? 0}</span></a
				>
			{/each}
		</nav>
		<form
			method="get"
			role="search"
			class="flex flex-wrap items-center gap-3"
			data-sveltekit-keepfocus
			data-sveltekit-noscroll
		>
			{#if data.type}<input type="hidden" name="type" value={data.type} />{/if}
			{#if data.status}<input type="hidden" name="status" value={data.status} />{/if}
			{#if data.favorite}<input type="hidden" name="fav" />{/if}
			<input
				type="search"
				name="q"
				value={data.q ?? ''}
				placeholder="Chercher dans ma bibliothèque"
				aria-label="Chercher dans ma bibliothèque"
				class="h-10 min-w-0 flex-[1_1_220px] rounded-xl border border-line bg-surface px-3.5 text-sm text-ink outline-none placeholder:text-muted focus:border-accent"
			/>
			<label class="flex items-center gap-2 text-sm text-muted">
				Trier par
				<select
					name="sort"
					class="h-10 rounded-xl border border-line bg-surface px-3 text-sm text-ink focus:border-accent"
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
				>
					{#each sorts as o (o.value)}
						<option value={o.value} selected={data.sort === o.value}>{o.label}</option>
					{/each}
				</select>
			</label>
			<button class="btn-ghost">Chercher</button>
		</form>
	</div>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->

	{#if data.entries.length}
		<ul class="grid [grid-template-columns:repeat(auto-fill,minmax(140px,1fr))] gap-x-5 gap-y-7">
			{#each data.entries as e (e.id)}
				{@const unit = unitLabel[e.type]}
				{@const progress = bumped[e.id] ?? e.progress}
				{@const canBump =
					!!unit && e.status === 'in_progress' && (!e.totalUnits || progress < e.totalUnits)}
				<li class="relative">
					<a
						href={resolve('/(app)/media/[id]', { id: String(e.mediaId) })}
						class="group flex flex-col gap-2.5 text-ink no-underline"
					>
						<div class="relative overflow-hidden rounded-xl tile-frame">
							<Poster src={e.posterUrl} title={e.title} type={e.type} class="w-full" />
							<div class="absolute top-2.5 left-2.5 flex flex-col items-start gap-1">
								<span
									class="flex items-center gap-1.5 rounded-md bg-black/75 px-2 py-0.5 text-xs font-semibold text-white"
									><span class="size-2 rounded-full {typeDot[e.type]}" aria-hidden="true"
									></span>{typeLabel[e.type]}</span
								>
								<span class="rounded-md bg-black/75 px-2 py-0.5 text-xs font-semibold text-white"
									>{statusLabel[e.status]}</span
								>
							</div>
							{#if e.isFavorite}
								<span
									class="absolute top-2.5 right-2.5 grid size-7 place-items-center rounded-full bg-black/75 text-[#f59ac0]"
									title="Favori"
									><svg
										width="15"
										height="15"
										viewBox="0 0 24 24"
										fill="currentColor"
										role="img"
										aria-label="Favori"
										><path
											d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"
										></path></svg
									></span
								>
							{/if}
							{#if unit && e.totalUnits && progress > 0 && e.status !== 'completed'}
								<span class="absolute inset-x-0 bottom-0 h-1 bg-black/50">
									<span
										class="block h-full bg-accent"
										style:width="{Math.min(100, Math.round((progress / e.totalUnits) * 100))}%"
									></span>
								</span>
							{/if}
						</div>
						<div>
							<p class="leading-snug font-semibold group-hover:underline">{e.title}</p>
							<p class="mt-0.5 text-[13px] text-muted">
								{[
									unit && progress
										? `${progress}${e.totalUnits ? `/${e.totalUnits}` : ''} ${unit}`
										: e.year,
									e.score !== null && `★ ${toScale(e.score, scale)}`
								]
									.filter(Boolean)
									.join(' · ')}
							</p>
						</div>
					</a>
					{#if canBump}
						<!-- Same box as the poster (full width, 2:3), so the button sits on its corner -->
						<div class="pointer-events-none absolute inset-x-0 top-0 aspect-[2/3]">
							<form
								method="post"
								action="?/increment"
								class="pointer-events-auto absolute right-2 bottom-3"
								use:enhance={() => {
									pending = e.id;
									return async ({ result }) => {
										pending = null;
										if (result.type === 'success') bumped[e.id] = progress + 1;
										else toast('La progression n’a pas pu être enregistrée.');
									};
								}}
							>
								<input type="hidden" name="entryId" value={e.id} />
								<button
									disabled={pending === e.id}
									aria-label="+1 pour {e.title}"
									class="btn-accent min-h-9 rounded-lg px-3 text-sm shadow-lg">+1</button
								>
							</form>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
		{#if data.pages > 1}
			<!-- eslint-disable svelte/no-navigation-without-resolve -- href() builds on resolve() -->
			<nav class="flex items-center justify-center gap-4 text-sm" aria-label="Pages">
				{#if data.page > 1}
					<a href={href({ page: data.page - 1 })} class="btn-ghost" rel="prev">Précédent</a>
				{/if}
				<span class="text-muted">Page {data.page} sur {data.pages}</span>
				{#if data.page < data.pages}
					<a href={href({ page: data.page + 1 })} class="btn-ghost" rel="next">Suivant</a>
				{/if}
			</nav>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}
	{:else if data.q || data.type || data.status || data.favorite || data.page > 1}
		<p class="text-muted">Aucune œuvre ne correspond.</p>
	{:else}
		<StartHere title="Ta bibliothèque est vide" />
	{/if}
</div>
