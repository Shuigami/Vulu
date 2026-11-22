<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import Meta from '#lib/components/Meta.svelte';
	import Poster from '#lib/components/Poster.svelte';
	import ShareButton from '#lib/components/ShareButton.svelte';
	import { MEDIA_TYPES, toScale, typePlural } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const r = $derived(data.recap);
	const name = $derived(data.owner.name);
	const scale = $derived(data.ratingScale);
	const path = $derived(`/u/${data.owner.username}/recap`);
	// A different URL once open, so previews cached during the teaser are not reused
	const cardQuery = $derived(data.preview ? '?apercu' : r ? '?v=open' : '');

	// Countdown to the release, ticking every second (server time is the reference)
	let now = $state(Date.now());
	onMount(() => {
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});
	const left = $derived(Math.max(0, Date.parse(data.release) - now));
	const countdown = $derived([
		{ value: Math.floor(left / 86_400_000), label: 'jours' },
		{ value: Math.floor(left / 3_600_000) % 24, label: 'heures' },
		{ value: Math.floor(left / 60_000) % 60, label: 'min' },
		{ value: Math.floor(left / 1000) % 60, label: 's' }
	]);

	const month = (m: number) =>
		new Intl.DateTimeFormat('fr-FR', { month: 'long' }).format(new Date(2026, m - 1, 15));
	const color: Record<string, string> = {
		movie: 'bg-movie',
		tv: 'bg-tv',
		anime: 'bg-anime',
		manga: 'bg-manga',
		book: 'bg-book'
	};
	const hoursByType = $derived(
		r ? MEDIA_TYPES.filter((t) => r.minutes[t] > 0).map((t) => ({ t, h: r.minutes[t] / 60 })) : []
	);
	const maxHours = $derived(Math.max(1, ...hoursByType.map((x) => x.h)));
	const completedTotal = $derived(r ? MEDIA_TYPES.reduce((n, t) => n + r.completed[t], 0) : 0);
	const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n));
</script>

<Meta
	title={r ? `Récap ${data.year} de ${name}` : `Récap ${data.year}`}
	description={r
		? `${fmt(r.hours)} heures, ${completedTotal} œuvres terminées${r.personality ? ` · ${r.personality.title}` : ''}`
		: `Le Récap ${data.year} arrive le ${data.releaseLabel}. Ton année en films, séries, anime, mangas et livres.`}
	card={`${path}/card.png${cardQuery}`}
/>

{#if !r}
	<!-- Teaser: only the date and blurred shapes, no data -->
	<section
		class="relative isolate flex flex-col items-center gap-8 overflow-hidden py-10 text-center"
	>
		<div aria-hidden="true" class="absolute inset-0 -z-10 opacity-60 blur-3xl">
			<div class="absolute top-8 left-[8%] size-56 rounded-full bg-movie/40"></div>
			<div class="absolute top-24 right-[10%] size-64 rounded-full bg-anime/40"></div>
			<div class="absolute bottom-0 left-[35%] size-60 rounded-full bg-accent/40"></div>
		</div>
		<p class="eyebrow">Bientôt sur Vulu</p>
		<h1
			class="font-display text-[72px] leading-[0.9] font-extrabold tracking-tight sm:text-[128px]"
		>
			Récap<br /><span class="text-accent-ink">{data.year}</span>
		</h1>
		<p class="max-w-md text-lg text-muted">
			{data.isSelf ? 'Ton' : `L’`}année en films, séries, anime, mangas et livres{data.isSelf
				? ''
				: ` de ${name}`}. Les heures, le top 5, le genre préféré… et un petit verdict.
		</p>
		<div class="flex gap-3" role="timer" aria-label="Temps avant la sortie">
			{#each countdown as c (c.label)}
				<div class="flex w-20 flex-col items-center card py-3 sm:w-24">
					<span class="font-display text-[36px] leading-none font-extrabold tabular-nums"
						>{String(c.value).padStart(2, '0')}</span
					>
					<span class="mt-1 text-xs text-muted">{c.label}</span>
				</div>
			{/each}
		</div>
		<p class="font-semibold">Rendez-vous le {data.releaseLabel}.</p>
		<!-- Blurred placeholders: the shape of what is coming, nothing real -->
		<div aria-hidden="true" class="grid w-full max-w-2xl grid-cols-3 gap-3 blur-md select-none">
			{#each [0, 1, 2] as i (i)}
				<div class="flex aspect-[2/3] items-center justify-center rounded-2xl bg-surface-2">
					<span class="font-display text-5xl font-extrabold text-muted">?</span>
				</div>
			{/each}
		</div>
		<div class="flex flex-wrap justify-center gap-2">
			<ShareButton title={`Récap ${data.year}`} {path} class="btn-accent" />
			{#if !data.isSelf}
				<a href={resolve('recap')} class="btn-ghost">Mon récap</a>
			{/if}
		</div>
	</section>
{:else}
	<div class="flex flex-col gap-6">
		<section class="flex flex-col gap-3 py-6">
			<p class="eyebrow">Récap {r.year}</p>
			<h1
				class="font-display text-[48px] leading-[0.95] font-extrabold tracking-tight sm:text-[80px]"
			>
				L’année de {name}
			</h1>
			{#if !completedTotal && !r.hours}
				<p class="text-muted">Rien de suivi cette année… pour l’instant.</p>
			{/if}
		</section>

		{#if r.hours}
			<section class="flex flex-col gap-6 card p-6 sm:p-10">
				<p class="eyebrow">Temps passé</p>
				<p class="font-display text-[64px] leading-none font-extrabold sm:text-[96px]">
					{fmt(r.hours)}<span class="text-[0.4em] text-muted">&nbsp;heures</span>
				</p>
				<ul class="flex flex-col gap-2.5">
					{#each hoursByType as x (x.t)}
						<li class="grid grid-cols-[6rem_1fr_4rem] items-center gap-3 text-sm">
							<span>{typePlural[x.t]}</span>
							<span class="h-3 rounded-full bg-surface-2"
								><span
									class="block h-full rounded-full {color[x.t]}"
									style:width="{(x.h / maxHours) * 100}%"
								></span></span
							>
							<span class="text-right text-muted tabular-nums">{fmt(x.h)} h</span>
						</li>
					{/each}
				</ul>
				{#if r.activeDays >= 10}
					<p class="text-muted">Actif {r.activeDays} jours sur 365.</p>
				{/if}
			</section>
		{/if}

		{#if completedTotal}
			<section class="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
				{#each MEDIA_TYPES.filter((t) => r.completed[t]) as t (t)}
					<div class="card p-5">
						<p class="font-display text-[44px] leading-none font-extrabold">{r.completed[t]}</p>
						<p class="mt-1 text-sm text-muted">
							{typePlural[t].toLowerCase()}
							{t === 'tv' ? 'terminées' : 'terminés'}
						</p>
					</div>
				{/each}
				{#if r.units.episode}
					<div class="card p-5">
						<p class="font-display text-[44px] leading-none font-extrabold">
							{fmt(r.units.episode)}
						</p>
						<p class="mt-1 text-sm text-muted">épisodes</p>
					</div>
				{/if}
				{#if r.units.chapter}
					<div class="card p-5">
						<p class="font-display text-[44px] leading-none font-extrabold">
							{fmt(r.units.chapter)}
						</p>
						<p class="mt-1 text-sm text-muted">chapitres</p>
					</div>
				{/if}
				{#if r.units.pages}
					<div class="card p-5">
						<p class="font-display text-[44px] leading-none font-extrabold">{fmt(r.units.pages)}</p>
						<p class="mt-1 text-sm text-muted">pages</p>
					</div>
				{/if}
			</section>
		{/if}

		{#if r.busiestMonth || r.genre}
			<section class="grid gap-3 sm:grid-cols-2">
				{#if r.busiestMonth}
					<div class="card p-6">
						<p class="eyebrow">Mois le plus chargé</p>
						<p class="mt-2 font-display text-[40px] font-extrabold capitalize">
							{month(r.busiestMonth)}
						</p>
					</div>
				{/if}
				{#if r.genre}
					<div class="card p-6">
						<p class="eyebrow">Genre préféré</p>
						<p class="mt-2 font-display text-[40px] font-extrabold">{r.genre}</p>
					</div>
				{/if}
			</section>
		{/if}

		{#if r.top.length}
			<section class="flex flex-col gap-5 card p-6 sm:p-10">
				<p class="eyebrow">Top {r.top.length} de l’année</p>
				<ol class="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4">
					{#each r.top as t, i (t.mediaId)}
						<li>
							<a
								href={resolve('/(app)/media/[id]', { id: String(t.mediaId) })}
								class="group flex flex-col gap-1.5 text-sm text-ink no-underline"
							>
								<span class="relative">
									<Poster src={t.posterUrl} title={t.title} class="w-full rounded-xl tile-frame" />
									<span
										class="absolute -top-2 -left-2 flex size-8 items-center justify-center rounded-full bg-accent font-display font-extrabold text-on-accent"
										>{i + 1}</span
									>
								</span>
								<span class="leading-tight font-semibold group-hover:underline">{t.title}</span>
								{#if t.score !== null}<span class="text-[13px] text-muted"
										>★ {toScale(t.score, scale)}/{scale}</span
									>{/if}
							</a>
						</li>
					{/each}
				</ol>
			</section>
		{/if}

		{#if r.personality}
			<section
				class="flex flex-col items-center gap-3 rounded-3xl bg-accent px-6 py-12 text-center text-on-accent"
			>
				<p class="text-[13px] font-semibold tracking-widest uppercase opacity-70">Verdict</p>
				<p class="font-display text-[44px] leading-none font-extrabold sm:text-[64px]">
					{r.personality.title}
				</p>
				<p class="text-lg">{r.personality.text}</p>
			</section>
		{/if}

		<section class="flex flex-wrap items-center justify-center gap-2 py-4">
			<ShareButton title={`Récap ${r.year} de ${name}`} {path} class="btn-accent" />
			<a
				href={`${path}/card.png?format=story${data.preview ? '&apercu' : ''}`}
				download={`recap-${r.year}-${data.owner.username}.png`}
				class="btn-ghost">Image pour ta story</a
			>
			{#if !data.isSelf}
				<a href={resolve('recap')} class="btn-ghost">Voir mon récap</a>
			{/if}
		</section>
	</div>
{/if}
