<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
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
	const storyFile = $derived(`recap-${data.year}-${data.owner.username}.png`);
	const ghost = 'btn border border-on-accent/30 text-on-accent hover:border-on-accent';

	// Slides: only those with something to show
	type Slide = 'open' | 'time' | 'done' | 'months' | 'top' | 'verdict';
	const slides = $derived<Slide[]>(
		r
			? (
					[
						'open',
						r.hours ? 'time' : null,
						completedTotal ? 'done' : null,
						r.busiestMonth ? 'months' : null,
						r.top.length ? 'top' : null,
						'verdict'
					] as (Slide | null)[]
				).filter((s): s is Slide => s !== null)
			: []
	);
	let current = $state(0);
	const active = $derived(slides[current]);
	const go = (i: number) => (current = Math.max(0, Math.min(slides.length - 1, i)));
	const reduced =
		typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	function onKey(e: KeyboardEvent) {
		if (e.altKey || e.ctrlKey || e.metaKey) return;
		if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
		const step = { ArrowRight: 1, PageDown: 1, ' ': 1, ArrowLeft: -1, PageUp: -1 }[e.key];
		if (step) {
			e.preventDefault();
			go(current + step);
		} else if (e.key === 'Home') go(0);
		else if (e.key === 'End') go(slides.length - 1);
	}

	// A click on the slide moves on, on its left third goes back; links and buttons keep theirs
	function onDeckClick(e: MouseEvent & { currentTarget: HTMLElement }) {
		if ((e.target as HTMLElement).closest('a, button')) return;
		const box = e.currentTarget.getBoundingClientRect();
		go(current + (e.clientX - box.left < box.width / 3 ? -1 : 1));
	}

	// The wheel turns the slides, one per gesture, unless the slide itself has to scroll
	let wheelLock = 0;
	function onWheel(e: WheelEvent & { currentTarget: HTMLElement }) {
		const slide = e.currentTarget.querySelector<HTMLElement>('[data-slide]');
		if (slide && slide.scrollHeight > slide.clientHeight + 4) return;
		if (Math.abs(e.deltaY) < 20 || Date.now() < wheelLock) return;
		wheelLock = Date.now() + 700;
		go(current + Math.sign(e.deltaY));
	}
</script>

<svelte:window onkeydown={(e) => r && onKey(e)} />

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
	<!-- One slide at a time, like a story: keys, wheel, click (left third goes back) or the dots.
		 The keys are handled on the window, so the click here is not the only way in. -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<div
		class="relative isolate -mt-4 h-[calc(100dvh-8.5rem-var(--nav-h))] overflow-hidden rounded-[28px] border border-line bg-surface select-none sm:-mt-6 md:h-[calc(100dvh-9rem)]"
		role="region"
		aria-roledescription="diaporama"
		aria-label="Récap {r.year} de {name}"
		onclick={onDeckClick}
		onwheel={onWheel}
	>
		<div class="absolute inset-x-4 top-3 z-20 flex gap-1.5 sm:inset-x-6 sm:top-4">
			{#each slides as s, i (s)}
				<button
					type="button"
					class="h-1.5 flex-1 cursor-pointer rounded-full motion-safe:transition-colors {i <=
					current
						? 'bg-ink'
						: 'bg-ink/15'}"
					aria-label="Diapositive {i + 1} sur {slides.length}"
					aria-current={i === current ? 'step' : undefined}
					onclick={() => go(i)}
				></button>
			{/each}
		</div>

		{#key current}
			<section
				data-slide
				aria-label="{current + 1} sur {slides.length}"
				class="absolute inset-0 flex flex-col overflow-y-auto px-5 pt-12 pb-20 sm:px-14 sm:pt-16 {active ===
				'verdict'
					? 'bg-accent text-on-accent'
					: ''}"
				in:fade={{ duration: reduced ? 0 : 280 }}
			>
				{#if active === 'open'}
					{#if wallPosters.length}
						<div aria-hidden="true" class="absolute inset-0 -z-10 overflow-hidden">
							<div
								class="recap-wall grid w-[130%] -translate-x-[12%] -translate-y-[6%] -rotate-6 grid-cols-5 gap-2 sm:grid-cols-8 sm:gap-3"
							>
								{#each wallPosters as w, i (i)}
									<img
										src={w.posterUrl}
										alt=""
										referrerpolicy="no-referrer"
										class="aspect-[2/3] w-full rounded-lg bg-surface-2 object-cover"
									/>
								{/each}
							</div>
						</div>
						<div
							aria-hidden="true"
							class="absolute inset-0 -z-10 bg-linear-to-t from-surface via-surface/80 via-45% to-surface/10"
						></div>
					{/if}
					<div class="mt-auto flex flex-col gap-4">
						<p class="text-lg text-muted sm:text-xl">L’année {r.year} de</p>
						<h1
							class="font-display text-[clamp(56px,min(13vw,20vh),168px)] leading-[0.85] font-extrabold tracking-[-0.04em] break-words"
						>
							{name}
						</h1>
						<p class="max-w-xl text-lg sm:text-xl">
							{#if completedTotal}
								{fmt(completedTotal)}
								{completedTotal > 1 ? 'œuvres terminées' : 'œuvre terminée'} en douze mois. Voici ce qu’il
								en reste.
							{:else}
								Rien de terminé cette année, pour l’instant.
							{/if}
						</p>
					</div>
				{:else if active === 'time'}
					<div class="my-auto grid items-end gap-10 md:grid-cols-[1fr_1.15fr]">
						<div>
							<p
								class="font-display text-[clamp(72px,min(15vw,24vh),176px)] leading-[0.82] font-extrabold tracking-[-0.04em] text-accent-ink tabular-nums"
							>
								{fmt(r.hours)}
							</p>
							<h2 class="mt-4 font-display text-2xl font-bold sm:text-3xl">
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
								class="flex h-14 overflow-hidden rounded-2xl sm:h-16"
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
					</div>
				{:else if active === 'done'}
					<div class="my-auto flex flex-col gap-5">
						<h2 class="text-lg text-muted">Terminés cette année</h2>
						<p
							class="max-w-5xl font-display text-[clamp(36px,min(6.5vw,10vh),80px)] leading-[1.02] font-extrabold tracking-[-0.03em]"
						>
							{#each doneTypes as t, i (t)}<span class={text[t]}
									>{fmt(r.completed[t])}&nbsp;{(r.completed[t] > 1
										? typePlural[t]
										: typeLabel[t]
									).toLowerCase()}</span
								>{i < doneTypes.length - 2
									? ', '
									: i === doneTypes.length - 2
										? ' et '
										: '.'}{/each}
						</p>
						{#if unitsLine}<p class="max-w-2xl text-lg text-muted">
								Et en chemin : {unitsLine}.
							</p>{/if}
					</div>
				{:else if active === 'months' && r.busiestMonth}
					{@const peak = r.perMonth[r.busiestMonth - 1]}
					<div class="my-auto flex flex-col gap-8">
						<h2
							class="max-w-3xl font-display text-[clamp(28px,min(4.5vw,7vh),48px)] leading-[1.05] font-extrabold"
						>
							{capitalize(month(r.busiestMonth))} a été le mois le plus chargé{peak
								? `, avec ${fmt(peak)} heures`
								: ''}.
						</h2>
						<ol class="grid h-[32vh] grid-cols-12 items-end gap-1.5 sm:gap-3">
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
					</div>
				{:else if active === 'top'}
					<div class="my-auto flex flex-col gap-6 sm:gap-8">
						<h2
							class="font-display text-[clamp(28px,min(4.5vw,7vh),48px)] leading-[1.05] font-extrabold"
						>
							Le top {r.top.length} de l’année
						</h2>
						<!-- A podium: the first stands taller, the rest line up beside it -->
						<ol class="grid grid-cols-4 gap-3 sm:flex sm:items-end sm:gap-5">
							{#each r.top as t, i (t.mediaId)}
								<li class={i === 0 ? 'col-span-4 sm:w-[min(28vh,20vw)]' : 'sm:w-[min(19vh,13vw)]'}>
									<a
										href={resolve('/(app)/media/[id]', { id: String(t.mediaId) })}
										class="group flex text-ink no-underline {i === 0
											? 'items-end gap-4 sm:flex-col sm:items-start sm:gap-3'
											: 'flex-col gap-2'}"
									>
										<Poster
											src={t.posterUrl}
											title={t.title}
											class="rounded-xl tile-frame {i === 0 ? 'w-28 sm:w-full' : 'w-full'}"
										/>
										<span class="flex items-baseline gap-2">
											<span
												class="font-display leading-none font-extrabold text-accent-ink tabular-nums {i ===
												0
													? 'text-[52px]'
													: 'text-[26px]'}">{i + 1}</span
											>
											<span class="flex min-w-0 flex-col">
												<span
													class="line-clamp-2 leading-tight font-semibold group-hover:underline {i ===
													0
														? 'text-lg'
														: 'text-sm max-sm:sr-only'}">{t.title}</span
												>
												{#if t.score !== null && i === 0}<span class="text-sm text-muted"
														>★ {toScale(t.score, scale)}/{scale}</span
													>{/if}
											</span>
										</span>
									</a>
								</li>
							{/each}
						</ol>
					</div>
				{:else if active === 'verdict'}
					<div class="my-auto flex flex-col items-start gap-6">
						{#if r.personality}
							<p class="text-lg">Le verdict</p>
							<p
								class="font-display text-[clamp(48px,min(10vw,16vh),128px)] leading-[0.88] font-extrabold tracking-[-0.04em]"
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
							<a href={storyHref} download={storyFile} class={ghost}>Image pour ta story</a>
							{#if !data.isSelf}
								<a href={resolve('recap')} class={ghost}>Voir mon récap</a>
							{/if}
						</div>
					</div>
				{/if}
			</section>
		{/key}

		<div class="absolute right-4 bottom-4 z-20 flex items-center gap-2 sm:right-6 sm:bottom-6">
			<span
				class="mr-1 text-sm tabular-nums {active === 'verdict'
					? 'text-on-accent/70'
					: 'text-muted'}">{current + 1} / {slides.length}</span
			>
			<button
				type="button"
				class="btn-ghost size-11 rounded-full px-0"
				aria-label="Précédente"
				disabled={current === 0}
				onclick={() => go(current - 1)}
				><svg
					aria-hidden="true"
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="m15 18-6-6 6-6"></path></svg
				></button
			>
			<button
				type="button"
				class="btn-accent size-11 rounded-full px-0"
				aria-label="Suivante"
				disabled={current === slides.length - 1}
				onclick={() => go(current + 1)}
				><svg
					aria-hidden="true"
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg
				></button
			>
		</div>
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
