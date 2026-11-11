<script lang="ts">
	import { flip } from 'svelte/animate';
	import type { TransitionConfig } from 'svelte/transition';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import ActivityFeed from '#lib/components/ActivityFeed.svelte';
	import MediaShelf from '#lib/components/MediaShelf.svelte';
	import Poster from '#lib/components/Poster.svelte';
	import Progress from '#lib/components/Progress.svelte';
	import ShelfSkeleton from '#lib/components/ShelfSkeleton.svelte';
	import StartHere from '#lib/components/StartHere.svelte';
	import TypeTag from '#lib/components/TypeTag.svelte';
	import { MEDIA_TYPES, toScale, typePlural, unitLabel } from '#lib/labels.ts';
	import type { DiscoverItem } from '#lib/server/discover.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	// The count swells and settles when it changes (not on first render: intros are off)
	const pop: (node: Element) => TransitionConfig = () =>
		matchMedia('(prefers-reduced-motion: reduce)').matches
			? { duration: 0 }
			: {
					duration: 320,
					css: (t: number) => `transform: scale(${1 + 0.45 * Math.sin(Math.PI * t)})`
				};
	// After +1 the work moves to the front of "Reprendre" (most recent first): the cards glide there
	const glide = (node: Element, move: { from: DOMRect; to: DOMRect }) =>
		flip(node, move, {
			duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450
		});
	let pending = $state<number | null>(null);
	const singular = { épisodes: 'épisode', chapitres: 'chapitre', pages: 'page' } as Record<
		string,
		string
	>;
	const scale = $derived(data.user.ratingScale);
	let trendType = $state<(typeof MEDIA_TYPES)[number]>('movie');
	const shelf = (items: DiscoverItem[]) =>
		items.map((r) => ({
			...r,
			key: `${r.provider}:${r.externalId}`,
			note: r.because ? `Parce que tu as aimé ${r.because}` : (r.year?.toString() ?? '')
		}));
</script>

<svelte:head><title>Accueil · Vulu</title></svelte:head>

<div class="flex flex-col gap-14">
	<h1 class="sr-only">Accueil</h1>

	<section aria-labelledby="resume" class="flex flex-col gap-5">
		<h2 id="resume" class="h2">Reprendre</h2>
		{#if data.entries.length}
			<ul class="grid [grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-4">
				{#each data.entries as e (e.id)}
					{@const unit = unitLabel[e.type]}
					{@const href = resolve('/(app)/media/[id]', { id: String(e.mediaId) })}
					<!-- The whole card opens the work (the title link covers it), except the +1 button -->
					<li animate:glide class="group relative flex gap-4 card p-3.5 tile-frame">
						<Poster src={e.posterUrl} title={e.title} type={e.type} class="w-21 rounded-[10px]" />
						<div class="flex min-w-0 flex-1 flex-col gap-1.5">
							<div><TypeTag type={e.type} /></div>
							<a
								{href}
								class="text-[17px] leading-tight font-semibold text-ink no-underline group-hover:underline after:absolute after:inset-0 after:rounded-2xl"
								>{e.title}</a
							>
							<p class="text-[13px] text-muted">
								{e.year ?? ''}{e.score !== null ? ` · ★ ${toScale(e.score, scale)}/${scale}` : ''}
							</p>
							{#if unit}
								<div class="mt-auto flex items-center gap-3">
									<div class="flex flex-1 flex-col gap-1.5">
										{#if e.totalUnits}
											<Progress
												value={e.progress}
												max={e.totalUnits}
												label="Progression de {e.title}"
											/>
										{/if}
										<p class="text-[13px] text-muted tabular-nums">
											{#key e.progress}<strong in:pop class="inline-block font-semibold text-ink"
													>{e.progress}</strong
												>{/key}{e.totalUnits ? ` / ${e.totalUnits}` : ''}
											{unit}
										</p>
									</div>
									<form
										class="relative z-10"
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
											class="btn-accent min-w-14">+1</button
										>
									</form>
								</div>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{:else}
			<StartHere title="Rien en cours pour l’instant" />
		{/if}
	</section>

	<section aria-labelledby="trending" class="flex flex-col gap-5">
		<div class="flex flex-wrap items-center justify-between gap-4">
			<h2 id="trending" class="h2">Tendances de la semaine</h2>
			<div class="scroll-row" role="group" aria-label="Type de tendances">
				{#each MEDIA_TYPES as t (t)}
					<button
						type="button"
						class={trendType === t ? 'chip-on' : 'chip'}
						aria-pressed={trendType === t}
						onclick={() => (trendType = t)}>{typePlural[t]}</button
					>
				{/each}
			</div>
		</div>
		{#await data.trending}
			<ShelfSkeleton label="Chargement des tendances" />
		{:then trending}
			{#if trending?.[trendType].length}
				<MediaShelf
					items={shelf(trending[trendType])}
					label="Tendances : {typePlural[trendType]}"
				/>
			{:else}
				<p class="text-muted">Tendances indisponibles pour le moment.</p>
			{/if}
		{/await}
	</section>

	{#await data.discoveries}
		<section aria-labelledby="discover" class="flex flex-col gap-5">
			<h2 id="discover" class="h2">Découvertes pour toi</h2>
			<ShelfSkeleton label="Chargement des découvertes" noteLines={2} />
		</section>
	{:then discoveries}
		{#if discoveries?.length}
			<section aria-labelledby="discover" class="flex flex-col gap-5">
				<h2 id="discover" class="h2">Découvertes pour toi</h2>
				<MediaShelf items={shelf(discoveries)} label="Découvertes pour toi" />
			</section>
		{/if}
	{/await}

	{#if data.popular.length}
		<section aria-labelledby="popular" class="flex flex-col gap-5">
			<h2 id="popular" class="h2">Populaire sur Vulu</h2>
			<MediaShelf
				items={data.popular.map((p) => ({
					...p,
					key: String(p.mediaId),
					note: `${p.members} membre${p.members > 1 ? 's' : ''} cette semaine`
				}))}
				label="Populaire sur Vulu"
			/>
		</section>
	{/if}

	<section aria-labelledby="week" class="flex flex-col gap-5">
		<div class="flex items-baseline justify-between gap-4">
			<h2 id="week" class="h2">Cette semaine</h2>
			<a href={resolve('calendar')} class="text-sm font-semibold">Tout le calendrier →</a>
		</div>
		{#if data.week.length}
			<ul class="grid [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4">
				{#each data.week as w (w.key)}
					<!-- Whole card opens the work, like the resume cards -->
					<li class="group relative flex gap-4 card p-3.5 tile-frame">
						<Poster src={w.posterUrl} title={w.mediaTitle} class="w-16 rounded-[10px]" />
						<div class="flex min-w-0 flex-1 flex-col gap-1">
							<div class="flex items-baseline justify-between gap-2">
								<p class="text-[13px] font-semibold text-accent-ink first-letter:uppercase">
									{w.weekday}
									{w.dayNumber}{w.time ? ` · ${w.time}` : ''}
								</p>
								<span
									class="shrink-0 rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted"
									>{w.countdown}</span
								>
							</div>
							<a
								href={resolve('/(app)/media/[id]', { id: String(w.mediaId) })}
								class="line-clamp-2 leading-tight font-semibold text-ink no-underline group-hover:underline after:absolute after:inset-0 after:rounded-2xl"
								>{w.mediaTitle}</a
							>
							<div class="mt-auto flex flex-col gap-1.5 pt-1">
								{#if w.totalUnits}
									<Progress
										value={w.progress}
										max={w.totalUnits}
										release={w.release}
										label="Progression de {w.mediaTitle}"
									/>
								{/if}
								<p class="flex justify-between gap-2 text-[13px] text-muted">
									<span class="truncate"
										>{w.episode}{w.count > 1 ? ` · ${w.count} épisodes` : ''}</span
									>
									{#if w.totalUnits}<span class="shrink-0 tabular-nums"
											><strong class="font-semibold text-ink">{w.progress}</strong> / {w.totalUnits}
											vus</span
										>{/if}
								</p>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-muted">Aucun épisode prévu dans les 7 prochains jours.</p>
		{/if}
	</section>

	<section aria-labelledby="friends" class="flex flex-col gap-3">
		<div class="flex items-baseline justify-between gap-4">
			<h2 id="friends" class="h2">Tes abonnements</h2>
			<a href={resolve('activity')} class="text-sm font-semibold">Toute l’activité →</a>
		</div>
		{#if data.friends.length}
			<ActivityFeed items={data.friends} {scale} />
		{:else}
			<p class="text-muted">
				Pas encore d’activité. Cherche des membres depuis la barre de recherche et abonne-toi pour
				voir ce qu’ils regardent et lisent.
			</p>
		{/if}
	</section>
</div>
