<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import Meta from '#lib/components/Meta.svelte';
	import Poster from '#lib/components/Poster.svelte';
	import ShareButton from '#lib/components/ShareButton.svelte';
	import { MEDIA_TYPES, toScale, typeLabel, typePlural, type MediaType } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const r = $derived(data.recap);
	const name = $derived(data.owner.name);
	const scale = $derived(data.ratingScale);
	const path = $derived(`/u/${data.owner.username}/recap`);
	// A different URL once open, so previews cached during the teaser are not reused
	const storyHref = $derived(
		`${resolve('/(app)/u/[username]/recap/card.png', { username: data.owner.username })}?format=story${data.preview ? '&apercu' : ''}`
	);
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
	const hoursByType = $derived(
		r ? MEDIA_TYPES.filter((t) => r.minutes[t] > 0).map((t) => ({ t, h: r.minutes[t] / 60 })) : []
	);
	const completedTotal = $derived(r ? MEDIA_TYPES.reduce((n, t) => n + r.completed[t], 0) : 0);
	const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n));
	const bg: Record<MediaType, string> = {
		movie: 'bg-movie',
		tv: 'bg-tv',
		anime: 'bg-anime',
		manga: 'bg-manga',
		book: 'bg-book'
	};
	const text: Record<MediaType, string> = {
		movie: 'text-movie',
		tv: 'text-tv',
		anime: 'text-anime',
		manga: 'text-manga',
		book: 'text-book'
	};
	const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
	// The wall needs enough posters to fill the opening: the year's few are repeated
	const wallPosters = $derived(
		r?.wall.length
			? Array.from({ length: Math.max(40, r.wall.length) }, (_, i) => r.wall[i % r.wall.length])
			: []
	);
	const doneTypes = $derived(r ? MEDIA_TYPES.filter((t) => r.completed[t] > 0) : []);
	const totalHours = $derived(
		Math.max(
			1,
			hoursByType.reduce((n, x) => n + x.h, 0)
		)
	);
	const maxMonth = $derived(Math.max(1, ...(r?.perMonth ?? [])));
	const unitsLine = $derived(
		r
			? [
					r.units.episode && `${fmt(r.units.episode)} épisodes vus`,
					r.units.chapter && `${fmt(r.units.chapter)} chapitres lus`,
					r.units.pages && `${fmt(r.units.pages)} pages tournées`
				]
					.filter(Boolean)
					.join(', ')
			: ''
	);
	const ghost = 'btn border border-on-accent/30 text-on-accent hover:border-on-accent';
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
	<div class="flex flex-col gap-20 sm:gap-28">
		<!-- Opening: a wall of the year's posters, the name set over it -->
		<section
			class="relative isolate -mx-4 -mt-10 flex min-h-[72vh] items-end overflow-hidden sm:-mx-6 sm:-mt-12 sm:min-h-[80vh] sm:rounded-b-[32px]"
		>
			{#if wallPosters.length}
				<div aria-hidden="true" class="absolute inset-0 -z-10 overflow-hidden">
					<div
						class="recap-wall grid w-[130%] -translate-x-[12%] -translate-y-[6%] -rotate-6 grid-cols-5 gap-2 sm:grid-cols-8 sm:gap-3"
					>
						{#each wallPosters as w, i (i)}
							<img
								src={w.posterUrl}
								alt=""
								loading={i < 16 ? 'eager' : 'lazy'}
								referrerpolicy="no-referrer"
								class="aspect-[2/3] w-full rounded-lg bg-surface-2 object-cover"
							/>
						{/each}
					</div>
				</div>
				<div
					aria-hidden="true"
					class="absolute inset-0 -z-10 bg-linear-to-t from-bg via-bg/80 via-45% to-bg/10"
				></div>
			{/if}
			<div class="flex flex-col gap-4 px-4 pb-10 sm:px-12 sm:pb-16">
				<p class="text-lg text-muted sm:text-xl">L’année {r.year} de</p>
				<h1
					class="font-display text-[clamp(56px,13vw,168px)] leading-[0.85] font-extrabold tracking-[-0.04em] break-words"
				>
					{name}
				</h1>
				{#if completedTotal}
					<p class="max-w-xl text-lg sm:text-xl">
						{fmt(completedTotal)}
						{completedTotal > 1 ? 'œuvres terminées' : 'œuvre terminée'} en douze mois. Voici ce qu’il
						en reste.
					</p>
				{:else}
					<p class="max-w-xl text-lg text-muted">Rien de terminé cette année, pour l’instant.</p>
				{/if}
			</div>
		</section>

		{#if r.hours}
			<section aria-labelledby="time" class="grid items-end gap-10 md:grid-cols-[1fr_1.15fr]">
				<div>
					<p
						class="font-display text-[clamp(80px,15vw,176px)] leading-[0.82] font-extrabold tracking-[-0.04em] text-accent-ink tabular-nums"
					>
						{fmt(r.hours)}
					</p>
					<h2 id="time" class="mt-4 font-display text-2xl font-bold sm:text-3xl">
						heures devant l’écran
					</h2>
					{#if r.hours >= 24}
						<p class="mt-2 text-muted">
							Soit {fmt(r.hours / 24)} jours entiers, sans dormir ni manger.
						</p>
					{/if}
				</div>
				<div class="flex flex-col gap-4">
					<div
						class="flex h-16 overflow-hidden rounded-2xl"
						role="img"
						aria-label={hoursByType.map((x) => `${typePlural[x.t]} : ${fmt(x.h)} h`).join(', ')}
					>
						{#each hoursByType as x (x.t)}
							<span class={bg[x.t]} style:width="{(x.h / totalHours) * 100}%"></span>
						{/each}
					</div>
					<ul class="flex flex-wrap gap-x-6 gap-y-2">
						{#each hoursByType as x (x.t)}
							<li class="flex items-center gap-2">
								<span class="size-3 rounded-full {bg[x.t]}" aria-hidden="true"></span>
								<span>{typePlural[x.t]}</span>
								<span class="text-muted tabular-nums">{fmt(x.h)} h</span>
							</li>
						{/each}
					</ul>
					{#if r.activeDays >= 10}
						<p class="text-sm text-muted">Actif {r.activeDays} jours sur 365.</p>
					{/if}
				</div>
			</section>
		{/if}

		{#if completedTotal}
			<section aria-labelledby="done" class="flex flex-col gap-5">
				<h2 id="done" class="text-lg text-muted">Terminés cette année</h2>
				<p
					class="max-w-5xl font-display text-[clamp(36px,6.5vw,80px)] leading-[1.02] font-extrabold tracking-[-0.03em]"
				>
					{#each doneTypes as t, i (t)}<span class={text[t]}
							>{fmt(r.completed[t])}&nbsp;{(r.completed[t] > 1
								? typePlural[t]
								: typeLabel[t]
							).toLowerCase()}</span
						>{i < doneTypes.length - 2 ? ', ' : i === doneTypes.length - 2 ? ' et ' : '.'}{/each}
				</p>
				{#if unitsLine}<p class="max-w-2xl text-lg text-muted">Et en chemin : {unitsLine}.</p>{/if}
			</section>
		{/if}

		{#if r.busiestMonth}
			{@const peak = r.perMonth[r.busiestMonth - 1]}
			<section aria-labelledby="months" class="flex flex-col gap-8">
				<h2
					id="months"
					class="max-w-3xl font-display text-[clamp(28px,4.5vw,48px)] leading-[1.05] font-extrabold"
				>
					{capitalize(month(r.busiestMonth))} a été le mois le plus chargé{peak
						? `, avec ${fmt(peak)} heures`
						: ''}.
				</h2>
				<ol class="grid h-56 grid-cols-12 items-end gap-1.5 sm:gap-3">
					{#each r.perMonth as h, i (i)}
						{@const busiest = i + 1 === r.busiestMonth}
						<li
							class="flex h-full flex-col justify-end gap-2"
							aria-label="{capitalize(month(i + 1))} : {fmt(h)} heures"
						>
							<span
								class="block min-h-1 rounded-t-lg {busiest ? 'bg-accent' : 'bg-surface-2'}"
								style:height="{(h / maxMonth) * 100}%"
							></span>
							<span
								class="text-center text-xs {busiest ? 'font-bold text-ink' : 'text-muted'}"
								aria-hidden="true"
								>{month(i + 1)
									.slice(0, 1)
									.toUpperCase()}</span
							>
						</li>
					{/each}
				</ol>
			</section>
		{/if}

		{#if r.top.length}
			<section aria-labelledby="top" class="flex flex-col gap-8">
				<h2
					id="top"
					class="font-display text-[clamp(28px,4.5vw,48px)] leading-[1.05] font-extrabold"
				>
					Le top {r.top.length} de l’année
				</h2>
				<ol class="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-[1.35fr_1fr_1fr] sm:gap-x-6">
					{#each r.top as t, i (t.mediaId)}
						<li class={i === 0 ? 'col-span-2 sm:col-span-1 sm:row-span-2' : ''}>
							<a
								href={resolve('/(app)/media/[id]', { id: String(t.mediaId) })}
								class="group flex gap-4 text-ink no-underline {i === 0
									? 'max-sm:items-end sm:flex-col'
									: 'flex-col'}"
							>
								<Poster
									src={t.posterUrl}
									title={t.title}
									class="rounded-xl tile-frame {i === 0 ? 'w-40 shrink-0 sm:w-full' : 'w-full'}"
								/>
								<span class="flex items-baseline gap-3">
									<span
										class="font-display leading-none font-extrabold text-accent-ink tabular-nums {i ===
										0
											? 'text-[64px]'
											: 'text-[36px]'}">{i + 1}</span
									>
									<span class="flex min-w-0 flex-col">
										<span
											class="leading-tight font-semibold group-hover:underline {i === 0
												? 'text-xl'
												: ''}">{t.title}</span
										>
										{#if t.score !== null}<span class="text-sm text-muted"
												>★ {toScale(t.score, scale)}/{scale}</span
											>{/if}
									</span>
								</span>
							</a>
						</li>
					{/each}
				</ol>
			</section>
		{/if}

		<!-- Finale: the verdict, then what to do with it -->
		<section
			class="-mx-4 flex flex-col items-start gap-6 bg-accent px-6 py-14 text-on-accent sm:mx-0 sm:rounded-[32px] sm:px-12 sm:py-20"
		>
			{#if r.personality}
				<p class="text-lg">Le verdict</p>
				<p
					class="font-display text-[clamp(48px,10vw,128px)] leading-[0.88] font-extrabold tracking-[-0.04em]"
				>
					{r.personality.title}
				</p>
				<p class="max-w-xl text-xl">
					{r.personality.text}{#if r.genre}
						Genre fétiche : {r.genre}.{/if}
				</p>
			{:else}
				<p class="font-display text-[clamp(36px,6vw,64px)] leading-none font-extrabold">
					L’année {r.year + 1} commence bientôt.
				</p>
			{/if}
			<div class="mt-4 flex flex-wrap gap-2">
				<ShareButton
					title={`Récap ${r.year} de ${name}`}
					{path}
					class="btn bg-on-accent text-accent"
				/>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- query on a resolved path -->
				<a href={storyHref} download={`recap-${r.year}-${data.owner.username}.png`} class={ghost}
					>Télécharger l’image pour ta story</a
				>
				{#if !data.isSelf}
					<a href={resolve('recap')} class={ghost}>Voir mon récap</a>
				{/if}
			</div>
		</section>
	</div>
{/if}

<style>
	/* The one moving thing: the opening wall drifts slowly upward */
	@media (prefers-reduced-motion: no-preference) {
		.recap-wall {
			animation: recap-drift 60s linear infinite alternate;
		}
	}
	@keyframes recap-drift {
		to {
			translate: 0 -18%;
		}
	}
</style>
