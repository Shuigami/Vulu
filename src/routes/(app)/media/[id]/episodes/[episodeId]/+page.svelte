<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import EpisodeStill from '#lib/components/EpisodeStill.svelte';
	import Poster from '#lib/components/Poster.svelte';
	import Progress from '#lib/components/Progress.svelte';
	import RatingHistogram from '#lib/components/RatingHistogram.svelte';
	import StarRating from '#lib/components/StarRating.svelte';
	import { toScale } from '#lib/labels.ts';
	import { postAction, toast } from '#lib/toast.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const m = $derived(data.media);
	const ep = $derived(data.episode);
	const scale = $derived(data.ratingScale);
	const episodeHref = (id: number) =>
		resolve('/(app)/media/[id]/episodes/[episodeId]', {
			id: String(m.id),
			episodeId: String(id)
		});
	// Back to the work, on this episode's season
	const backHref = $derived(
		`${resolve('/(app)/media/[id]', { id: String(m.id) })}${ep.seasonId ? `?saison=${ep.seasonId}` : ''}#episodes-title`
	);
	const seasonName = $derived(
		ep.seasonNumber === null
			? 'Épisodes'
			: ep.seasonNumber === 0
				? 'Épisodes spéciaux'
				: `Saison ${ep.seasonNumber}`
	);
	const position = $derived(ep.season && ep.season.episodes.findIndex((e) => e.id === ep.id) + 1);
	// Stars count in halves: 1 to 10 half-stars
	const rated = $derived(ep.myScore == null ? 0 : Math.round(ep.myScore / 10));

	let busy = $state(false);
	async function send(action: 'episode' | 'rate', fields: Record<string, string | number>) {
		busy = true;
		const res = await postAction(`?/${action}`, fields).catch(() => null);
		const result = res?.ok ? await res.json() : null;
		await invalidateAll();
		busy = false;
		if (result?.type !== 'success') toast('Échec, réessaie.');
	}
	// The season strip opens on this episode, without scrolling the page itself, then slides
	// to each episode reached from it (previous / next, the strip itself)
	let strip = $state<HTMLOListElement>();
	let stripShown = false;
	$effect(() => {
		void ep.id;
		const li = strip?.querySelector<HTMLElement>('[aria-current="page"]')?.parentElement;
		if (!strip || !li) return;
		const slide = stripShown && !matchMedia('(prefers-reduced-motion: reduce)').matches;
		strip.scrollTo({
			left: li.offsetLeft - (strip.clientWidth - li.clientWidth) / 2,
			behavior: slide ? 'smooth' : 'instant'
		});
		stripShown = true;
	});
	const toggleSeen = () => send('episode', { seen: String(!ep.seen) });
	// Clicking the current rating again clears it
	const rate = (h: number) => send('rate', { score: h === rated ? '' : toScale(h * 10, scale) });
	const neighbourMeta = (n: NonNullable<typeof ep.next>) =>
		n.seen ? (n.seenOn ? `Vu le ${n.seenOn}` : 'Vu') : n.airDate ? `Diffusé le ${n.airDate}` : '';
</script>

<svelte:head><title>{ep.label} · {m.title} · Vulu</title></svelte:head>

{#snippet check(size: number)}
	<svg
		aria-hidden="true"
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="3"
		stroke-linecap="round"
		stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"></path></svg
	>
{/snippet}
{#snippet chevron(d: string)}
	<svg
		aria-hidden="true"
		class="shrink-0 text-muted"
		width="20"
		height="20"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"><path {d}></path></svg
	>
{/snippet}

<div class="flex flex-col gap-8 pb-24 md:pb-0">
	<!-- Back to the work: always the first thing on the page -->
	<nav aria-label="Fil d'Ariane" class="flex flex-wrap items-center gap-x-6 gap-y-3">
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- query on a resolved path -->
		<a href={backHref} class="flex min-w-0 items-center gap-3 text-ink no-underline">
			{@render chevron('m15 6-6 6 6 6')}
			<Poster src={m.posterUrl} title={m.title} type={m.type} class="w-9 shrink-0 rounded-md" />
			<span class="flex min-w-0 flex-col leading-tight">
				<span class="truncate font-semibold">{m.title}</span>
				<span class="text-[13px] text-muted"
					>{seasonName}{ep.season?.title && ep.season.title !== seasonName
						? ` · ${ep.season.title}`
						: ''}</span
				>
			</span>
			<span class="ml-auto shrink-0 text-[13px] font-semibold text-accent-ink sm:hidden"
				>Voir la série</span
			>
		</a>
		{#if ep.season && position}
			<div class="flex min-w-56 flex-1 items-center justify-end gap-3 max-sm:hidden">
				<span class="text-[13px] whitespace-nowrap text-muted tabular-nums"
					>Épisode {position} sur {ep.season.episodes.length}</span
				>
				{#if data.user}
					<div class="w-40">
						<Progress
							value={ep.season.seen}
							max={ep.season.episodes.length}
							label="Épisodes vus de la saison"
						/>
					</div>
				{/if}
			</div>
		{/if}
	</nav>

	<div class="flex flex-wrap items-start gap-x-10 gap-y-6">
		<div class="min-w-0 flex-[3_1_520px] max-sm:-mx-4">
			<EpisodeStill src={ep.stillUrl} class="sm:rounded-2xl" />
		</div>

		<div class="flex min-w-0 flex-[2_1_340px] flex-col gap-5">
			<header class="flex flex-col gap-2">
				<p class="text-[13px] font-bold tracking-wider text-muted tabular-nums">{ep.label}</p>
				<h1
					class="font-display text-[32px] leading-none font-extrabold tracking-tight text-balance sm:text-[44px]"
				>
					{ep.title ?? `Épisode ${ep.number}`}
				</h1>
				<p class="text-muted">
					{[
						ep.airDate && (ep.aired ? `Diffusé le ${ep.airDate}` : `Diffusion le ${ep.airDate}`),
						ep.runtimeMinutes ? `${ep.runtimeMinutes} min` : null
					]
						.filter(Boolean)
						.join(' · ')}
				</p>
			</header>

			{#if ep.overview}
				<p class="leading-relaxed">{ep.overview}</p>
			{/if}

			{#if data.user}
				<section aria-label="Mon suivi" class="flex flex-col gap-4 card rounded-[20px] p-4">
					<div class="flex flex-wrap items-center gap-x-4 gap-y-2 max-md:hidden">
						<button
							type="button"
							aria-pressed={ep.seen}
							disabled={busy || !ep.aired}
							onclick={toggleSeen}
							class={ep.seen ? 'btn border-2 border-success text-success' : 'btn-accent'}
							>{@render check(18)}{ep.seen ? 'Vu' : 'Marquer vu'}</button
						>
						<span class="text-[13px] {ep.seenOn.length ? 'text-success' : 'text-muted'}"
							>{#if ep.seenOn.length}Vu le {ep.seenOn.join(', ')}{:else if !ep.aired}Pas encore
								diffusé{:else if ep.seasonNumber !== 0}Marque aussi les épisodes d'avant{/if}</span
						>
					</div>
					<p class="text-[13px] md:hidden {ep.seenOn.length ? 'text-success' : 'text-muted'}">
						{ep.seenOn.length ? `Vu le ${ep.seenOn.join(', ')}` : 'Pas encore vu'}
					</p>
					<div class="h-px bg-line max-md:hidden"></div>
					<div class="flex flex-wrap items-center justify-between gap-2">
						<span class="text-sm font-semibold">Ma note pour cet épisode</span>
						<StarRating {rated} onrate={rate} />
					</div>
					<p class="text-xs text-muted">
						Séparée de la note de la série. Clique à nouveau pour l'effacer.
					</p>
				</section>
			{:else}
				<p class="text-sm text-muted">
					<a href="{resolve('login')}?redirectTo={encodeURIComponent(episodeHref(ep.id))}"
						>Connecte-toi</a
					> pour marquer cet épisode comme vu et le noter.
				</p>
			{/if}

			<section aria-labelledby="community-title" class="flex flex-col gap-2">
				<h2 id="community-title" class="text-[13px] font-semibold text-muted">Note des membres</h2>
				{#if ep.community.count}
					<RatingHistogram {...ep.community} {scale} />
				{:else}
					<p class="text-sm text-muted">Pas encore de note.</p>
				{/if}
			</section>
		</div>
	</div>

	{#if ep.previous || ep.next}
		<nav aria-label="Épisodes voisins" class="grid gap-3 sm:grid-cols-2">
			{#each [ep.previous, ep.next] as n, i (i)}
				{#if n}
					<a
						href={episodeHref(n.id)}
						class="flex min-w-0 items-center gap-3 card p-3 text-ink no-underline hover:border-muted {i
							? 'sm:col-start-2 sm:flex-row-reverse sm:text-right'
							: ''}"
					>
						{@render chevron(i ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6')}
						<span class="w-24 shrink-0 sm:w-28"><EpisodeStill src={n.stillUrl} /></span>
						<span class="flex min-w-0 flex-col">
							<span class="text-xs text-muted">{i ? 'Suivant' : 'Précédent'} · {n.label}</span>
							<span class="truncate font-semibold">{n.title ?? n.label}</span>
							<span class="text-xs {n.seen ? 'text-success' : 'text-muted'}"
								>{neighbourMeta(n)}</span
							>
						</span>
					</a>
				{/if}
			{/each}
		</nav>
	{/if}

	{#if ep.season && ep.season.episodes.length > 1}
		<section aria-labelledby="season-strip" class="flex flex-col gap-3">
			<div class="flex items-baseline justify-between gap-3">
				<h2 id="season-strip" class="h2 text-xl">
					{ep.seasonNumber === null ? 'Épisodes' : 'Dans cette saison'}
				</h2>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- query on a resolved path -->
				<a href={backHref} class="text-sm font-semibold">Tous les épisodes</a>
			</div>
			<ol bind:this={strip} class="relative flex gap-3 overflow-x-auto pb-1">
				{#each ep.season.episodes as e (e.id)}
					{@const current = e.id === ep.id}
					<li class="w-40 shrink-0">
						<a
							href={episodeHref(e.id)}
							aria-current={current ? 'page' : undefined}
							class="flex flex-col gap-1 rounded-2xl border p-2 text-ink no-underline {current
								? 'border-accent bg-accent/10'
								: 'border-line bg-surface hover:border-muted'}"
						>
							<EpisodeStill src={e.stillUrl} />
							<span
								class="text-xs {current
									? 'text-accent-ink'
									: e.seen
										? 'text-success'
										: 'text-muted'}"
								>E{e.number}{current ? ' · cet épisode' : e.seen ? ' · vu' : ''}</span
							>
							<span class="truncate text-sm font-semibold">{e.title ?? `Épisode ${e.number}`}</span>
						</a>
					</li>
				{/each}
			</ol>
		</section>
	{/if}
</div>

{#if data.user}
	<!-- Phones: seen and next stay under the thumb -->
	<div
		class="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-2 border-t border-line bg-surface/95 px-4 py-2.5 backdrop-blur md:hidden"
	>
		<button
			type="button"
			aria-pressed={ep.seen}
			disabled={busy || !ep.aired}
			onclick={toggleSeen}
			class="flex-1 {ep.seen ? 'btn border-2 border-success text-success' : 'btn-accent'}"
			>{@render check(18)}{ep.seen ? 'Vu · annuler' : 'Marquer vu'}</button
		>
		{#if ep.next}
			<a href={episodeHref(ep.next.id)} aria-label="Épisode suivant" class="btn-ghost w-12 px-0"
				>{@render chevron('m9 6 6 6-6 6')}</a
			>
		{/if}
	</div>
{/if}
