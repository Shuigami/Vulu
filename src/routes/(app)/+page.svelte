<script lang="ts">
	import { untrack } from 'svelte';
	import { flip } from 'svelte/animate';
	import type { TransitionConfig } from 'svelte/transition';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import ActivityFeed from '#lib/components/ActivityFeed.svelte';
	import Marquee from '#lib/components/Marquee.svelte';
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
	const pitches = [
		{
			title: 'Une progression, cinq formats',
			text: 'Épisodes, chapitres, pages : un +1 suffit, le statut et les dates suivent tout seuls.'
		},
		{
			title: 'Ce qui sort, au bon moment',
			text: 'Le calendrier réunit les prochains épisodes de tout ce que tu suis.'
		},
		{
			title: 'Arrive avec ton historique',
			text: 'Importe ta bibliothèque en quelques clics, et Jellyfin coche les épisodes pour toi.'
		}
	];
	let pending = $state<number | null>(null);
	const singular = { épisodes: 'épisode', chapitres: 'chapitre', pages: 'page' } as Record<
		string,
		string
	>;
	const scale = $derived(data.ratingScale);
	// +1 reloads the page data: keep the first provider lists, or every shelf would load again
	const { trending, discoveries } = untrack(() => data);
	let trendType = $state<(typeof MEDIA_TYPES)[number]>('movie');
	const shelf = (items: DiscoverItem[]) =>
		items.map((r) => ({
			...r,
			key: `${r.provider}:${r.externalId}`,
			note: r.because ? `Parce que tu as aimé ${r.because}` : (r.year?.toString() ?? '')
		}));
</script>

<svelte:head><title>Accueil · Vulu</title></svelte:head>

<div class="flex flex-col gap-3 sm:gap-10">
	{#if !data.user}
		<!-- Signed out: say what Vulu is before the shelves -->
		<section class="flex flex-col gap-8 pb-4 sm:gap-10 sm:pb-2">
			<div class="flex max-w-2xl flex-col gap-5">
				<ul class="flex flex-wrap gap-2" aria-label="Types suivis">
					{#each MEDIA_TYPES as t (t)}
						<li><TypeTag type={t} label={typePlural[t]} /></li>
					{/each}
				</ul>
				<h1 class="h1 text-balance">
					Tout ce que tu regardes et lis, <span class="text-accent-ink">au même endroit.</span>
				</h1>
				<p class="text-lg text-muted">
					Note tes films, avance d’un épisode ou d’un chapitre en un geste, et vois ce qui sort
					cette semaine pour tout ce que tu suis.
				</p>
				<div class="flex flex-wrap items-center gap-3">
					<a href={resolve('signup')} class="btn-accent px-6">Créer mon compte</a>
					<a href="#trending" class="btn-ghost">Explorer sans compte</a>
				</div>
				<p class="text-[13px] text-muted">
					Importe ta bibliothèque depuis Letterboxd, MyAnimeList, AniList, Trakt ou Goodreads.
				</p>
			</div>
			<ul class="grid [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-4">
				{#each pitches as p (p.title)}
					<li class="flex flex-col gap-1.5 card p-5">
						<h2 class="font-display text-lg font-bold">{p.title}</h2>
						<p class="text-muted">{p.text}</p>
					</li>
				{/each}
			</ul>
		</section>
	{:else}
		<h1 class="sr-only">Accueil</h1>
	{/if}

	{#if data.user}
		<section aria-labelledby="resume" class="flex flex-col gap-2.5 sm:gap-4">
			<h2 id="resume" class="h2">Reprendre</h2>
			{#if data.entries.length}
				<!-- One scrollable row, like the shelves below; the padding keeps card shadows visible -->
				<ul
					class="-mx-2 -mt-2 flex snap-x scroll-px-2 [scrollbar-width:thin] gap-4 overflow-x-auto px-2 pt-2 pb-2"
				>
					{#each data.entries as e (e.id)}
						{@const unit = unitLabel[e.type]}
						{@const href = resolve('/(app)/media/[id]', { id: String(e.mediaId) })}
						<!-- The whole card opens the work (a link covers it), except the +1 button. The link is
						     not the title: the scrolling title's transform would shrink its click area. -->
						<li
							animate:glide
							class="group relative flex w-[min(340px,85vw)] shrink-0 snap-start gap-4 card p-3.5 tile-frame"
						>
							<a {href} class="absolute inset-0 rounded-2xl"
								><span class="sr-only">{e.title}</span></a
							>
							<!-- self-start: cards share the row's height, the poster keeps its 2:3 -->
							<Poster
								src={e.posterUrl}
								title={e.title}
								type={e.type}
								class="w-21 self-start rounded-[10px]"
							/>
							<div class="flex min-w-0 flex-1 flex-col gap-1">
								<div><TypeTag type={e.type} /></div>
								<!-- One line, scrolling when too long: every card fits the poster's height -->
								<div aria-hidden="true">
									<Marquee
										class="text-[17px] leading-tight font-semibold text-ink group-hover:underline"
									>
										{e.title}
									</Marquee>
								</div>
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
	{/if}

	<section aria-labelledby="trending" class="flex flex-col gap-2.5 sm:gap-4">
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
		{#await trending[trendType]}
			<ShelfSkeleton label="Chargement des tendances" />
		{:then list}
			{#if list?.length}
				<MediaShelf items={shelf(list)} label="Tendances : {typePlural[trendType]}" />
			{:else}
				<p class="text-muted">Tendances indisponibles pour le moment.</p>
			{/if}
		{/await}
	</section>

	{#await discoveries}
		<section aria-labelledby="discover" class="flex flex-col gap-2.5 sm:gap-4">
			<h2 id="discover" class="h2">Découvertes pour toi</h2>
			<ShelfSkeleton label="Chargement des découvertes" noteLines={2} />
		</section>
	{:then list}
		{#if list?.length}
			<section aria-labelledby="discover" class="flex flex-col gap-2.5 sm:gap-4">
				<h2 id="discover" class="h2">Découvertes pour toi</h2>
				<MediaShelf items={shelf(list)} label="Découvertes pour toi" />
			</section>
		{/if}
	{/await}

	{#if data.popular.length}
		<section aria-labelledby="popular" class="flex flex-col gap-2.5 sm:gap-4">
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

	{#if data.user}
		<section aria-labelledby="week" class="flex flex-col gap-2.5 sm:gap-4">
			<div class="flex items-baseline justify-between gap-4">
				<h2 id="week" class="h2">Cette semaine</h2>
				<a href={resolve('calendar')} class="text-sm font-semibold">Tout le calendrier →</a>
			</div>
			{#if data.week.length}
				<ul
					class="grid [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4"
				>
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
	{/if}
</div>
