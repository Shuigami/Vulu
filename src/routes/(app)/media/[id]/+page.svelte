<script lang="ts">
	import Meta from '#lib/components/Meta.svelte';
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Avatar from '#lib/components/Avatar.svelte';
	import Marquee from '#lib/components/Marquee.svelte';
	import Poster from '#lib/components/Poster.svelte';
	import RatingHistogram from '#lib/components/RatingHistogram.svelte';
	import EpisodeStill from '#lib/components/EpisodeStill.svelte';
	import Progress from '#lib/components/Progress.svelte';
	import StarRating from '#lib/components/StarRating.svelte';
	import TypeTag from '#lib/components/TypeTag.svelte';
	import {
		ENTRY_STATUSES,
		releaseStatusLabel,
		rewatchLabel,
		secondaryUnitLabel,
		statusLabel,
		toScale,
		typeLabel,
		unitLabel
	} from '#lib/labels.ts';
	import { postAction, toast } from '#lib/toast.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const m = $derived(data.media);
	const entry = $derived(data.entry);
	const scale = $derived(data.ratingScale);
	const unit = $derived(unitLabel[m.type]);
	const secondary = $derived(secondaryUnitLabel[m.type]);
	const year = $derived(m.startDate?.slice(0, 4));
	const extra = $derived(
		m.extra as { genres?: string[]; studios?: string[]; authors?: string[]; format?: string }
	);
	const makers = $derived((m.type === 'book' ? extra.authors : extra.studios) ?? []);
	const sourceUrl = $derived.by(() => {
		const id = data.externalIds[0];
		if (!id) return null;
		if (id.provider === 'tmdb') return `https://www.themoviedb.org/${m.type}/${id.externalId}`;
		if (id.provider === 'anilist') return `https://anilist.co/${m.type}/${id.externalId}`;
		if (id.provider === 'openlibrary') return `https://openlibrary.org/works/${id.externalId}`;
		return null;
	});
	const sourceName = $derived(
		{ tmdb: 'TMDB', anilist: 'AniList', openlibrary: 'Open Library' }[
			data.externalIds[0]?.provider as string
		]
	);
	const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
	// Release dates are plain YYYY-MM-DD, read in UTC so server and browser agree
	const monthYear = new Intl.DateTimeFormat('fr-FR', {
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	});
	const releaseDates = $derived.by(() => {
		if (!m.startDate) return null;
		const start = monthYear.format(new Date(m.startDate));
		return m.endDate && m.endDate !== m.startDate
			? `${start} → ${monthYear.format(new Date(m.endDate))}`
			: start;
	});
	const facts = $derived(
		[
			['Format', extra.format?.replaceAll('_', ' ') ?? typeLabel[m.type]],
			[m.type === 'book' ? 'Auteur' : 'Studio', makers.join(', ')],
			[m.type === 'tv' || m.type === 'anime' ? 'Diffusion' : 'Sortie', releaseDates],
			[
				unit && capitalize(unit),
				m.totalUnits && `${m.totalUnits}${m.runtimeMinutes ? ` × ${m.runtimeMinutes} min` : ''}`
			],
			[m.type === 'movie' && 'Durée', m.runtimeMinutes && `${m.runtimeMinutes} min`],
			[secondary && capitalize(secondary), m.totalUnitsSecondary],
			['Titre original', m.originalTitle !== m.title && m.originalTitle]
		].filter(([k, v]) => k && v) as [string, string | number][]
	);

	const duration = (min: number) =>
		min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
	const singular = (u: string) => u.replace(/s$/, '');
	const sourceLabel: Record<string, string | null> = {
		manual: null,
		jellyfin: 'via Jellyfin',
		plex: 'via Plex',
		import: 'import',
		api: 'API'
	};
	function journalLabel(e: (typeof data.journal)[number]) {
		const n = e.amount ?? 0;
		if (['episode', 'chapter', 'pages'].includes(e.kind) && unit)
			return `+${n} ${n > 1 ? unit : singular(unit)}`;
		if (e.kind === 'volume') return `+${n} volume${n > 1 ? 's' : ''}`;
		if (e.kind === 'started') return 'Commencé';
		if (e.kind === 'completed') return 'Terminé';
		if (e.kind === 'rated') return `Noté ${toScale(n, scale)}/${scale}`;
		return 'Statut modifié';
	}
	const journalDot: Record<string, string> = {
		completed: 'bg-success',
		started: 'bg-success',
		rated: 'bg-anime'
	};

	let entryForm: HTMLFormElement | undefined = $state();
	let progress = $derived(entry?.progress ?? 0);
	let confirmRemove = $state(false);
	let expanded = $state(false);
	// Closed again once the entry changes (removed, re-added, or another work opened)
	$effect(() => {
		void entry?.id;
		confirmRemove = false;
	});
	// Every change is saved right away: no "save" button to forget
	const save = () => entryForm?.requestSubmit();
	async function setProgress(n: number) {
		progress = Math.max(0, m.totalUnits ? Math.min(m.totalUnits, n) : n);
		await tick();
		save();
	}
	// Typed in the field or set from the stars, in the user's scale (null when not rated)
	let score = $derived<number | null>(entry?.score == null ? null : toScale(entry.score, scale));
	// Stars count in halves: 1 to 10 half-stars
	const rated = $derived(score == null ? 0 : Math.round((score / scale) * 10));
	async function rate(h: number) {
		// Clicking the current rating again clears it
		score = h === rated ? null : toScale(h * 10, scale);
		await tick();
		save();
	}
	const undoAdd = async (entryId: number) => {
		await postAction('?/remove', { entryId });
		await invalidateAll();
	};
	const showGrid = $derived(
		!!entry &&
			!!m.totalUnits &&
			m.totalUnits <= 200 &&
			['tv', 'anime', 'manga'].includes(m.type) &&
			!data.seasons.length
	);
	// Season shown: picked by the user, else the one holding the next episode to watch
	let seasonPick = $state<number | null>(null);
	$effect(() => {
		void m.id;
		// Back from an episode page: its season
		seasonPick = Number(page.url.searchParams.get('saison')) || null;
	});
	const season = $derived(
		data.seasons.find((s) => s.id === seasonPick) ??
			data.seasons.find((s) => s.episodes.some((e) => e.absolute === progress + 1)) ??
			data.seasons[0]
	);
	// Next episode to watch: the first aired one not seen yet (specials do not count)
	const nextUp = $derived.by(() => {
		for (const s of data.seasons)
			for (const e of s.episodes)
				if (e.absolute !== null && e.aired && !e.seen)
					return {
						...e,
						label: s.number === null ? `Ép. ${e.number}` : `S${s.number}E${e.number}`
					};
		return null;
	});
	// "Everything seen": the last aired numbered episode, which covers all those before it
	const lastAired = $derived(
		data.seasons.flatMap((s) => s.episodes).findLast((e) => e.absolute !== null && e.aired)
	);
	const episodeHref = (id: number) =>
		resolve('/(app)/media/[id]/episodes/[episodeId]', {
			id: String(m.id),
			episodeId: String(id)
		});
	type Season = (typeof data.seasons)[number];
	const seasonName = (s: Season) =>
		s.number === null
			? 'Tous les épisodes'
			: s.number === 0
				? 'Épisodes spéciaux'
				: `Saison ${s.number}${s.title && s.title !== `Saison ${s.number}` ? ` · ${s.title}` : ''}`;
	let marking = $state(false);
	async function mark(action: 'episode' | 'season', fields: Record<string, string | number>) {
		marking = true;
		const res = await postAction(`?/${action}`, fields).catch(() => null);
		const result = res?.ok ? await res.json() : null;
		await invalidateAll();
		marking = false;
		if (result?.type !== 'success') toast('Échec, réessaie.');
	}
	// Phones: a +1 bar stays at the bottom once the tracking block has scrolled out of view
	let trackingVisible = $state(true);
	$effect(() => {
		if (!entryForm) return;
		// Only once scrolled past it: below the fold at load, the bar would just repeat it
		const observer = new IntersectionObserver(
			([e]) => (trackingVisible = e.isIntersecting || e.boundingClientRect.top > 0)
		);
		observer.observe(entryForm);
		return () => observer.disconnect();
	});
	// "More options" menu: placed under its button when opened; closed on scroll, a click
	// elsewhere or Escape, since a fixed menu would not follow the page
	let moreMenu: HTMLDetailsElement | undefined = $state();
	let menuAt = $state({ top: 0, right: 0 });
	const closeMenu = () => moreMenu?.open && (moreMenu.open = false);
	// Unit hovered (or focused) in the grid: the units it would mark as seen are tinted
	let previewTo = $state(0);
	// Dates fold under the stars; the summary says what is set
	let datesOpen = $state(false);
	const dayFormat = new Intl.DateTimeFormat('fr-FR', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	});
	const datesSummary = $derived.by(() => {
		if (!entry) return '';
		const day = (d: string) => dayFormat.format(new Date(d));
		const dates = entry.completedOn
			? `Terminé le ${day(entry.completedOn)}`
			: entry.startedOn
				? `Commencé le ${day(entry.startedOn)}`
				: 'Dates';
		return entry.repeatCount
			? `${dates} · ${rewatchLabel[m.type].done.toLowerCase()} ${entry.repeatCount} fois`
			: dates;
	});
</script>

<Meta
	title={year ? `${m.title} (${year})` : m.title}
	description={m.overview}
	image={m.posterUrl}
/>

<svelte:window
	onscroll={closeMenu}
	onresize={closeMenu}
	onclick={(e) => {
		if (moreMenu?.open && !e.composedPath().includes(moreMenu)) closeMenu();
	}}
	onkeydown={(e) => e.key === 'Escape' && closeMenu()}
/>

<div class="flex flex-col gap-6 sm:gap-10">
	<div class="flex flex-col">
		{#if m.backdropUrl}
			<!-- The bottom fades into the page so the poster and title sit on it. Phones: edge to
				 edge, right under the header (cancels the gutters and top padding of <main>) -->
			<div
				class="relative overflow-hidden rounded-3xl max-sm:-mx-4 max-sm:-mt-10 max-sm:rounded-none"
			>
				<img
					src={m.backdropUrl}
					alt=""
					referrerpolicy="no-referrer"
					class="h-52 w-full bg-surface-2 object-cover sm:h-80"
				/>
				<div
					class="absolute inset-0 bg-linear-to-t from-bg via-bg/30 via-35% to-transparent"
					aria-hidden="true"
				></div>
			</div>
		{/if}
		<!-- Phones: title and facts on the left, a smaller poster on the right -->
		<section
			class="relative flex items-start gap-x-4 gap-y-6 sm:flex-wrap sm:gap-x-10 {m.backdropUrl
				? '-mt-14 sm:-mt-44'
				: ''}"
		>
			<Poster
				src={m.posterUrl}
				title={m.title}
				type={m.type}
				class="w-28 rounded-xl max-sm:order-last sm:w-60 sm:rounded-2xl {m.backdropUrl
					? 'border-4 border-bg shadow-xl sm:ml-8'
					: ''}"
			/>
			<div
				class="flex min-w-0 flex-1 flex-col gap-2.5 sm:flex-[1_1_420px] sm:gap-3.5 {m.backdropUrl
					? 'pt-8 sm:pt-0 md:pt-48'
					: ''}"
			>
				<div class="flex flex-wrap items-center gap-2">
					<TypeTag type={m.type} />
					{#if m.status}<span
							class="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted"
							>{releaseStatusLabel[m.status]}</span
						>{/if}
				</div>
				<h1
					class="font-display leading-[1.05] font-extrabold tracking-tight text-balance sm:text-[48px] {m
						.title.length > 28
						? 'text-[22px]'
						: 'text-[26px]'}"
				>
					{m.title}
				</h1>
				<Marquee class="text-muted">
					{[
						m.originalTitle !== m.title ? m.originalTitle : null,
						year,
						m.totalUnits && unit ? `${m.totalUnits} ${unit}` : null,
						m.runtimeMinutes ? `${m.runtimeMinutes} min` : null,
						makers.slice(0, 2).join(', ')
					]
						.filter(Boolean)
						.join(' · ')}
				</Marquee>
				{#if data.ratings.count && data.ratings.average !== null}
					<a href="#members-title" class="flex items-center gap-2 text-sm text-muted no-underline">
						<span
							class="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-0.5 font-bold text-accent-ink"
							><span aria-hidden="true">★</span>
							{toScale(data.ratings.average, scale)}<span class="font-semibold opacity-70"
								>/{scale}</span
							></span
						>
						{data.ratings.count} note{data.ratings.count > 1 ? 's' : ''} sur Vulu
					</a>
				{/if}
				{#if extra.genres?.length}
					<ul class="flex flex-wrap gap-1.5" aria-label="Genres">
						{#each extra.genres as g (g)}
							<li class="rounded-full border border-line bg-surface px-3 py-1 text-[13px]">{g}</li>
						{/each}
					</ul>
				{/if}
				{#if data.upcoming}
					<p class="flex items-center gap-2 text-sm">
						<svg
							aria-hidden="true"
							class="shrink-0 text-accent-ink"
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							><rect x="3" y="5" width="18" height="16" rx="2"></rect><path
								d="M3 10h18M8 3v4M16 3v4"
							></path></svg
						>
						<span
							>Prochaine sortie : <strong>{data.upcoming.episode}</strong>, {data.upcoming.day}{data
								.upcoming.time
								? ` à ${data.upcoming.time}`
								: ''}</span
						>
					</p>
				{/if}
			</div>
		</section>
	</div>

	{#if data.user && nextUp}
		<section
			aria-labelledby="next-up"
			class="flex flex-wrap items-center gap-4 card rounded-[22px] p-4 sm:gap-5 sm:p-5"
		>
			<a
				href={episodeHref(nextUp.id)}
				tabindex="-1"
				aria-hidden="true"
				class="w-32 shrink-0 sm:w-44"><EpisodeStill src={nextUp.stillUrl} class="rounded-xl" /></a
			>
			<div class="flex min-w-0 flex-[1_1_200px] flex-col gap-1">
				<h2 id="next-up" class="text-xs font-bold tracking-widest text-accent-ink uppercase">
					À voir ensuite
				</h2>
				<a
					href={episodeHref(nextUp.id)}
					class="font-display text-lg leading-tight font-bold text-ink no-underline hover:underline sm:text-xl"
					>{nextUp.label} · {nextUp.title ?? `Épisode ${nextUp.number}`}</a
				>
				<span class="text-[13px] text-muted"
					>{[
						nextUp.airDate && `Diffusé le ${nextUp.airDate}`,
						nextUp.runtime && `${nextUp.runtime} min`
					]
						.filter(Boolean)
						.join(' · ')}</span
				>
			</div>
			<div class="flex flex-wrap gap-2 max-sm:w-full">
				{#if lastAired && lastAired.id !== nextUp.id}
					<!-- Series-wide, so it sits with the next episode, away from the season controls -->
					<button
						type="button"
						class="btn-ghost text-sm max-sm:flex-1"
						disabled={marking}
						onclick={() => mark('episode', { episodeId: lastAired.id, seen: 'true' })}
						>Marquer toute la série comme vue</button
					>
				{/if}
				<button
					type="button"
					class="btn-accent max-sm:flex-1"
					disabled={marking}
					onclick={() => mark('episode', { episodeId: nextUp.id, seen: 'true' })}
					><svg
						aria-hidden="true"
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="3"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"></path></svg
					>Marquer vu</button
				>
			</div>
		</section>
	{/if}

	{#if !entry}
		<form
			method="post"
			action="?/add"
			use:enhance={() =>
				async ({ result, update }) => {
					await update();
					const added = data.entry;
					if (result.type === 'success' && added)
						toast('Ajouté à ta bibliothèque', () => undoAdd(added.id));
				}}
			class="flex flex-wrap items-center gap-x-7 gap-y-4 card rounded-[22px] px-6 py-5 max-md:fixed max-md:inset-x-0 max-md:bottom-(--nav-h) max-md:z-30 max-md:rounded-none max-md:border-x-0 max-md:border-b-0 max-md:bg-surface/95 max-md:px-4 max-md:pt-3 max-md:pb-[calc(0.75rem+var(--nav-pad))] max-md:backdrop-blur max-md:transition-[bottom]"
		>
			<!-- Phones: a bar fixed above the tab bar, so the synopsis stays in view -->
			{#if data.user}
				<div class="flex-[1_1_260px] max-md:sr-only">
					<h2 class="h2 text-xl">Ajouter à ma bibliothèque</h2>
					<p class="text-sm text-muted">Choisis directement où tu en es.</p>
				</div>
			{:else}
				<!-- Signed out: the buttons lead to the login page, say so before -->
				<div class="flex-[1_1_260px] max-md:-mb-2">
					<h2 class="h2 text-xl max-md:sr-only">Ajouter à ma bibliothèque</h2>
					<p class="text-sm text-muted">Crée un compte gratuit pour suivre cette œuvre.</p>
				</div>
			{/if}
			<div class="flex flex-wrap gap-2 max-md:w-full max-md:flex-nowrap">
				<button name="status" value="planned" class="btn-accent px-5 max-md:flex-[1.4]"
					>{statusLabel.planned}</button
				>
				{#if m.type !== 'movie'}
					<button name="status" value="in_progress" class="btn-ghost max-md:flex-1 max-md:px-2"
						>{statusLabel.in_progress}</button
					>
				{/if}
				<button name="status" value="completed" class="btn-ghost max-md:flex-1 max-md:px-2"
					>Déjà {m.type === 'manga' || m.type === 'book' ? 'lu' : 'vu'}</button
				>
			</div>
		</form>
	{:else}
		<form
			bind:this={entryForm}
			id="entry"
			method="post"
			action="?/update"
			use:enhance={({ action }) =>
				async ({ result, update }) => {
					await update({ reset: false });
					if (action.search === '?/remove' && result.type === 'success')
						toast('Retiré de ta bibliothèque');
					if (action.search === '?/rewatch' && result.type === 'success')
						toast(m.type === 'manga' || m.type === 'book' ? 'Bonne relecture' : 'Bon visionnage');
				}}
			onchange={save}
			class="overflow-hidden card rounded-[22px]"
		>
			<h2 class="sr-only">Mon suivi</h2>
			<input type="hidden" name="entryId" value={entry.id} />
			{#if !unit}<input type="hidden" name="progress" value={entry.progress} />{/if}
			{#if !secondary}<input
					type="hidden"
					name="progressSecondary"
					value={entry.progressSecondary}
				/>{/if}

			<!-- One compact card: status and actions, progress, then stars and dates -->
			<div class="flex flex-col gap-3.5 p-4 sm:gap-4 sm:p-5">
				<div class="flex items-center gap-2">
					<label class="flex min-w-0 items-center gap-2.5">
						<span class="sr-only sm:not-sr-only sm:text-[13px] sm:text-muted">Statut</span>
						<select name="status" value={entry.status} class="field min-h-10 font-semibold">
							{#each ENTRY_STATUSES as s (s)}
								<option value={s}>{statusLabel[s]}</option>
							{/each}
						</select>
					</label>
					<label
						class="ml-auto btn-ghost min-h-10 w-10 bg-surface px-0 has-checked:border-anime has-focus-visible:outline-2 has-focus-visible:outline-accent"
						title="Favori"
					>
						<input
							name="isFavorite"
							type="checkbox"
							checked={entry.isFavorite}
							class="peer sr-only"
						/>
						<svg
							aria-hidden="true"
							width="17"
							height="17"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="2"
							class="fill-none text-muted peer-checked:fill-current peer-checked:text-anime"
							><path
								d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"
							></path></svg
						>
						<span class="sr-only">Favori</span>
					</label>
					<details bind:this={moreMenu}>
						<summary
							aria-label="Plus d’options"
							class="btn-ghost min-h-10 w-10 list-none bg-surface px-0 [&::-webkit-details-marker]:hidden"
							onclick={(e) => {
								const r = e.currentTarget.getBoundingClientRect();
								menuAt = { top: r.bottom + 8, right: innerWidth - r.right };
							}}
						>
							<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"
								><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"
								></circle><circle cx="19" cy="12" r="2"></circle></svg
							>
						</summary>
						<!-- Fixed, so the tracking card's rounded clipping (overflow-hidden) does not cut it -->
						<div
							class="fixed z-40 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-1 card p-2 shadow-xl"
							style:top="{menuAt.top}px"
							style:right="{menuAt.right}px"
						>
							<label class="flex min-h-11 items-center gap-2.5 px-2 text-sm">
								<input
									name="isPrivate"
									type="checkbox"
									checked={entry.isPrivate}
									class="size-4 accent-accent"
								/>
								Masquer de mon profil
							</label>
							<!-- Confirmed in the page: native confirm() is blocked in some browsers and webviews -->
							{#if confirmRemove}
								<div class="flex flex-col gap-2 border-t border-line p-2">
									<p class="text-sm">Retirer cette œuvre de ta bibliothèque ?</p>
									<div class="flex gap-2">
										<button formaction="?/remove" class="btn bg-danger text-sm text-bg"
											>Retirer</button
										>
										<button
											type="button"
											class="btn-ghost text-sm"
											onclick={() => (confirmRemove = false)}>Annuler</button
										>
									</div>
								</div>
							{:else}
								<button
									type="button"
									class="min-h-11 cursor-pointer rounded-lg px-2 text-left text-sm text-danger hover:bg-surface-2"
									onclick={() => (confirmRemove = true)}>Retirer de ma bibliothèque</button
								>
							{/if}
						</div>
					</details>
				</div>

				{#if unit}
					<div class="flex flex-col gap-2">
						<div class="flex items-center gap-3">
							<label for="progress" class="sr-only">Progression · {unit}</label>
							<p
								class="flex min-w-0 items-baseline gap-1.5 font-display text-[28px] leading-none font-extrabold tabular-nums sm:text-[34px]"
							>
								<input
									id="progress"
									name="progress"
									type="number"
									min="0"
									max={m.totalUnits ?? undefined}
									bind:value={progress}
									style:width="{String(progress).length + 0.6}ch"
									class="rounded-lg bg-transparent text-right outline-offset-4"
								/>
								<span class="truncate font-sans text-[15px] font-semibold text-muted"
									>{#if m.totalUnits}/ {m.totalUnits}{/if}
									{unit}</span
								>
							</p>
							<div class="ml-auto flex shrink-0 gap-2">
								<button
									type="button"
									class="btn-ghost w-11 px-0 text-xl"
									aria-label="Retirer un"
									onclick={() => setProgress(progress - 1)}>−</button
								>
								<button
									type="button"
									class="btn-accent px-3.5"
									onclick={() => setProgress(progress + 1)}
									>+1<span class="max-[360px]:sr-only">{singular(unit)}</span></button
								>
							</div>
						</div>
						{#if m.totalUnits}
							<Progress value={progress} max={m.totalUnits} label="Progression" />
							<span class="text-xs text-muted"
								>{Math.round((progress / m.totalUnits) * 100)} %{#if progress < m.totalUnits}
									· reste {m.totalUnits - progress}{#if m.runtimeMinutes}, environ {duration(
											(m.totalUnits - progress) * m.runtimeMinutes
										)}{/if}<span class="max-sm:hidden">
										· prochain : <strong class="text-ink">{singular(unit)} {progress + 1}</strong
										></span
									>{/if}</span
							>
						{/if}
						{#if secondary}
							<label class="flex items-center gap-2 text-[13px] text-muted">
								{capitalize(secondary)}
								<input
									name="progressSecondary"
									type="number"
									min="0"
									value={entry.progressSecondary}
									class="field min-h-9 w-20 px-2"
								/>
								{#if m.totalUnitsSecondary}sur {m.totalUnitsSecondary}{/if}
							</label>
						{/if}
					</div>
				{/if}

				<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
					<div class="flex items-center">
						<span class="sr-only">Ma note</span>
						<StarRating {rated} onrate={rate} size={28} />
						<!-- The stars are the only control; the score travels in the user's scale -->
						<input type="hidden" name="score" value={score ?? ''} />
					</div>
					<button
						type="button"
						class="flex min-h-10 cursor-pointer items-center gap-1 text-[13px] text-muted hover:text-ink"
						aria-expanded={datesOpen}
						aria-controls="entry-dates"
						onclick={() => (datesOpen = !datesOpen)}
						>{datesSummary}<svg
							aria-hidden="true"
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.4"
							stroke-linecap="round"
							class="transition-transform {datesOpen ? 'rotate-180' : ''}"
							><path d="m6 9 6 6 6-6"></path></svg
						></button
					>
				</div>
			</div>

			<!-- Dates and rewatches: folded, they change rarely -->
			<div
				id="entry-dates"
				class="grid-cols-2 items-center gap-x-3 gap-y-2 border-t border-line bg-bg/50 px-4 py-3 text-[13px] text-muted sm:flex-wrap sm:gap-x-7 sm:px-5 {datesOpen
					? 'grid sm:flex'
					: 'hidden'}"
			>
				<label class="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
					Commencé le
					<input
						name="startedOn"
						type="date"
						value={entry.startedOn ?? ''}
						class="field min-h-9 min-w-0 px-2 text-[13px]"
					/>
				</label>
				<label class="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
					Terminé le
					<input
						name="completedOn"
						type="date"
						value={entry.completedOn ?? ''}
						class="field min-h-9 min-w-0 px-2 text-[13px]"
					/>
				</label>
				<label class="flex items-center gap-2">
					{rewatchLabel[m.type].done}
					<input
						name="repeatCount"
						type="number"
						min="0"
						value={entry.repeatCount}
						class="field min-h-9 w-16 px-2 text-[13px]"
					/>
					fois
				</label>
				{#if entry.status === 'completed'}
					<button formaction="?/rewatch" class="btn-ghost min-h-9 text-[13px]"
						>{rewatchLabel[m.type].verb}</button
					>
				{/if}
			</div>
			{#if form?.error}<p role="alert" class="px-4 pb-3 text-[13px] text-danger sm:px-5">
					{form.error}
				</p>{/if}
			<!-- Saving is instant and visible in the card itself: announced to screen readers only -->
			{#if form?.saved}<p role="status" class="sr-only">Enregistré.</p>{/if}
		</form>
	{/if}

	<div class="flex flex-wrap items-start gap-x-12 gap-y-10">
		<div class="flex min-w-0 flex-[999_1_560px] flex-col gap-10">
			{#if m.overview}
				<section aria-labelledby="synopsis-title" class="flex flex-col gap-3">
					<h2 id="synopsis-title" class="h2">Synopsis</h2>
					<p
						id="synopsis"
						class="max-w-[64ch] whitespace-pre-line {expanded ? '' : 'line-clamp-5'}"
					>
						{m.overview}
					</p>
					{#if m.overview.length > 400}
						<button
							type="button"
							aria-expanded={expanded}
							aria-controls="synopsis"
							class="min-h-8 cursor-pointer self-start text-sm font-semibold text-accent-ink"
							onclick={() => (expanded = !expanded)}
							>{expanded ? 'Réduire' : 'Lire la suite'}</button
						>
					{/if}
				</section>
			{/if}

			{#if showGrid && m.totalUnits && unit}
				<section aria-labelledby="units-title" class="flex flex-col gap-3.5">
					<div class="flex flex-wrap items-baseline justify-between gap-3">
						<h2 id="units-title" class="h2">{capitalize(unit)}</h2>
						<span class="text-[13px] text-muted"
							>Clique un {singular(unit)} pour y placer ta progression</span
						>
					</div>
					<ol
						class="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1.5"
						onmouseleave={() => (previewTo = 0)}
						onfocusout={() => (previewTo = 0)}
					>
						{#each Array.from({ length: m.totalUnits }, (_, i) => i + 1) as n (n)}
							{@const preview = n > progress && n <= previewTo}
							<li>
								<button
									type="button"
									aria-label="{capitalize(singular(unit))} {n}{n <= progress
										? ', vu'
										: n === progress + 1
											? ', prochain'
											: ''}"
									class="h-11 w-full cursor-pointer rounded-[10px] text-sm font-semibold tabular-nums motion-safe:transition-colors {n <=
									progress
										? 'bg-accent text-on-accent'
										: preview
											? 'bg-accent/35 text-ink'
											: 'bg-surface-2 text-muted'}"
									onmouseenter={() => (previewTo = n)}
									onfocus={() => (previewTo = n)}
									onclick={() => {
										previewTo = 0;
										setProgress(n);
									}}>{n}</button
								>
							</li>
						{/each}
					</ol>
				</section>
			{/if}

			{#if season}
				{@const left = season.episodes.filter((e) => e.aired && !e.seen)}
				<section aria-labelledby="episodes-title" class="flex flex-col gap-3.5">
					<div class="flex flex-wrap items-baseline justify-between gap-3">
						<h2 id="episodes-title" class="h2">Épisodes</h2>
						{#if data.user}
							<span class="text-[13px] text-muted"
								>Coche un épisode : tout ce qui précède est vu</span
							>
						{/if}
					</div>
					<div class="flex flex-wrap items-center gap-x-5 gap-y-3">
						{#if data.seasons.length > 1}
							<label class="relative flex min-w-0 items-center">
								<span class="sr-only">Saison</span>
								<select
									value={season.id}
									onchange={(e) => (seasonPick = Number(e.currentTarget.value))}
									class="field max-w-full cursor-pointer appearance-none pr-10 font-semibold"
								>
									{#each data.seasons as s (s.id)}
										<option value={s.id}>{seasonName(s)}</option>
									{/each}
								</select>
								<svg
									aria-hidden="true"
									class="pointer-events-none absolute right-3.5 text-muted"
									width="18"
									height="18"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg
								>
							</label>
						{:else if season.number !== null}
							<h3 class="font-semibold">{seasonName(season)}</h3>
						{/if}
						{#if data.user}
							<div class="flex min-w-48 flex-1 items-center gap-3">
								<div class="flex-1">
									<Progress
										value={season.seen}
										max={season.episodes.length}
										label="Épisodes vus de la saison"
									/>
								</div>
								<span class="text-[13px] whitespace-nowrap text-muted tabular-nums"
									>{season.seen} / {season.episodes.length} vus</span
								>
							</div>
						{/if}
					</div>
					{#if data.user && left.length}
						<button
							type="button"
							class="btn-ghost self-start text-sm"
							disabled={marking}
							onclick={() => mark('season', { seasonId: season.id })}
							>Marquer {season.number === null
								? 'tous les épisodes diffusés'
								: season.number === 0
									? 'les épisodes spéciaux'
									: `la saison ${season.number}`} comme vu{season.number === null
								? 's'
								: 'e'}</button
						>
					{/if}
					<ol
						class="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line"
					>
						{#each season.episodes as e (e.id)}
							{@const isNext = nextUp?.id === e.id}
							<!-- The whole row opens the episode (its title link covers it); the tick stays on top -->
							<li
								class="group relative flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2 has-[a:focus-visible]:bg-surface-2 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-accent motion-safe:transition-colors sm:px-4 {e.aired
									? ''
									: 'opacity-60'} {isNext ? 'bg-accent/10' : ''}"
							>
								{#if data.user}
									<button
										type="button"
										aria-pressed={e.seen}
										aria-label="Épisode {e.number}{e.title ? `, ${e.title}` : ''} : {e.seen
											? 'vu, marquer comme pas vu'
											: 'marquer comme vu'}"
										disabled={marking || !e.aired}
										class="relative z-10 mr-1 grid size-6 shrink-0 cursor-pointer place-items-center rounded-full border-2 before:absolute before:-inset-2.5 before:content-[''] disabled:cursor-default motion-safe:transition-colors {e.seen
											? 'border-accent bg-accent text-on-accent'
											: 'border-line text-transparent hover:border-accent'}"
										onclick={() => mark('episode', { episodeId: e.id, seen: String(!e.seen) })}
										><svg
											aria-hidden="true"
											width="12"
											height="12"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="3"
											stroke-linecap="round"
											stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"></path></svg
										></button
									>
								{/if}
								<span class="hidden w-28 shrink-0 sm:block"><EpisodeStill src={e.stillUrl} /></span>
								<span class="w-7 shrink-0 text-sm font-semibold text-muted tabular-nums"
									>{e.number}</span
								>
								<span class="flex min-w-0 flex-1 flex-col">
									<span class="flex min-w-0 items-center gap-2">
										<a
											href={episodeHref(e.id)}
											class="truncate font-semibold text-ink no-underline outline-none after:absolute after:inset-0"
											>{e.title ?? `Épisode ${e.number}`}</a
										>
										{#if isNext}
											<span
												class="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-on-accent"
												>À voir</span
											>
										{/if}
									</span>
									<span class="text-xs {e.seen && e.seenOn ? 'text-success' : 'text-muted'}"
										>{#if !e.aired}Diffusion le {e.airDate}{:else if e.seen && e.seenOn}Vu le {e.seenOn}{:else}{[
												e.airDate,
												e.runtime && `${e.runtime} min`
											]
												.filter(Boolean)
												.join(' · ')}{/if}</span
									>
								</span>
								{#if e.average !== null}
									<span
										class="shrink-0 text-[13px] text-muted tabular-nums"
										title="Note des membres">★ {toScale(e.average, scale)}</span
									>
								{/if}
								<span
									aria-hidden="true"
									class="hidden size-9 shrink-0 place-items-center text-muted group-hover:text-ink motion-safe:transition-colors sm:grid"
									><svg
										aria-hidden="true"
										width="18"
										height="18"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"><path d="m9 6 6 6-6 6"></path></svg
									></span
								>
							</li>
						{/each}
					</ol>
				</section>
			{/if}

			{#if entry}
				<section aria-labelledby="review-title" class="flex flex-col gap-3.5">
					<h2 id="review-title" class="h2">Ma critique</h2>
					<textarea
						form="entry"
						name="review"
						rows="4"
						aria-labelledby="review-title"
						placeholder="Ce que tu en as pensé. Visible sur ton profil et ici, chez les membres."
						onchange={save}
						class="field rounded-2xl px-4 py-3">{entry.review ?? ''}</textarea
					>
					<label class="flex items-center gap-2.5 text-sm">
						<input
							form="entry"
							name="reviewSpoiler"
							type="checkbox"
							checked={entry.reviewSpoiler}
							onchange={save}
							class="size-4 accent-accent"
						/>
						Contient des spoilers <span class="text-muted">· masquée chez les autres</span>
					</label>
					<details class="card px-5" open={!!entry.notes}>
						<summary class="flex min-h-13 cursor-pointer items-center font-semibold"
							>Notes privées <span class="ml-2 font-normal text-muted">· visibles par toi seul</span
							></summary
						>
						<textarea
							form="entry"
							name="notes"
							rows="3"
							aria-label="Notes privées"
							onchange={save}
							class="mb-4 field w-full py-2.5">{entry.notes ?? ''}</textarea
						>
					</details>
				</section>
			{/if}
		</div>

		<aside class="flex min-w-0 flex-[1_1_320px] flex-col gap-8">
			{#if entry && data.journal.length}
				<section aria-labelledby="journal-title" class="flex flex-col gap-3.5">
					<h2 id="journal-title" class="h2">Mon journal</h2>
					<ol>
						{#each data.journal as e (e.id)}
							<li class="flex gap-3.5">
								<div class="flex w-3 shrink-0 flex-col items-center" aria-hidden="true">
									<span class="mt-1.5 size-2.5 rounded-full {journalDot[e.kind] ?? 'bg-accent'}"
									></span>
									<span class="mt-1 w-0.5 flex-1 bg-line"></span>
								</div>
								<div class="pb-4">
									<p class="font-semibold">{journalLabel(e)}</p>
									<p class="text-[13px] text-muted">
										{[e.when, sourceLabel[e.source]].filter(Boolean).join(' · ')}
									</p>
								</div>
							</li>
						{/each}
					</ol>
				</section>
			{/if}

			{#if data.user}
				<section aria-labelledby="lists-title" class="flex flex-col gap-3.5">
					<h2 id="lists-title" class="h2">Mes listes</h2>
					<div class="flex flex-col gap-1 card p-2">
						{#each data.lists as l (l.id)}
							<form
								method="post"
								action="?/toggleList"
								use:enhance={() =>
									async ({ result, update }) => {
										await update();
										if (result.type !== 'success') return;
										// `l` is refreshed: `has` is the new state, the undo posts it to toggle back
										const { id, name, has } = l;
										const undo = async () => {
											await postAction('?/toggleList', { listId: id, has: String(has) });
											await invalidateAll();
										};
										toast(has ? `Ajouté à « ${name} »` : `Retiré de « ${name} »`, undo);
									}}
							>
								<input type="hidden" name="listId" value={l.id} />
								<input type="hidden" name="has" value={String(l.has)} />
								<button
									role="checkbox"
									aria-checked={l.has}
									class="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 text-left text-sm hover:bg-surface-2"
								>
									<span
										class="grid size-4.5 shrink-0 place-items-center rounded border text-[11px] font-bold {l.has
											? 'border-accent bg-accent text-on-accent'
											: 'border-line'}"
										aria-hidden="true">{l.has ? '✓' : ''}</span
									>{l.name}
								</button>
							</form>
						{/each}
						<form
							method="post"
							action="?/newList"
							use:enhance
							class="flex gap-2 p-1 {data.lists.length ? 'border-t border-line pt-2' : ''}"
						>
							<input
								name="name"
								required
								maxlength="80"
								placeholder="Nouvelle liste"
								aria-label="Nom de la nouvelle liste"
								class="field min-h-10 min-w-0 flex-1 text-sm"
							/>
							<button class="btn-ghost text-sm">Créer</button>
						</form>
						{#if form?.listError}<p role="alert" class="px-2 pb-1 text-sm text-danger">
								{form.listError}
							</p>{/if}
					</div>
				</section>
			{/if}

			<section aria-labelledby="info-title" class="flex flex-col gap-3.5">
				<h2 id="info-title" class="h2">Fiche</h2>
				<dl class="card px-4.5 py-1">
					{#each facts as [k, v] (k)}
						<div class="flex justify-between gap-4 border-b border-line py-2.75 text-sm">
							<dt class="shrink-0 text-muted">{k}</dt>
							<dd class="min-w-0 text-right font-semibold break-words">{v}</dd>
						</div>
					{/each}
					{#if data.minutesSpent}
						<div class="flex justify-between gap-4 border-b border-line py-2.75 text-sm">
							<dt class="text-muted">
								{m.type === 'manga' || m.type === 'book'
									? 'Mon temps de lecture'
									: 'Mon temps passé'}
							</dt>
							<dd class="text-right font-semibold">{duration(data.minutesSpent)}</dd>
						</div>
					{/if}
					{#if sourceUrl}
						<div class="py-3">
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external link -->
							<a href={sourceUrl} rel="external" class="text-sm font-semibold"
								>Voir sur {sourceName} ↗</a
							>
						</div>
					{/if}
				</dl>
			</section>
		</aside>
	</div>

	{#if data.ratings.count || data.followed.length || data.reviews.length}
		<section aria-labelledby="members-title" class="flex flex-col gap-8 border-t border-line pt-10">
			<h2 id="members-title" class="h2 text-[28px]">Chez les membres</h2>
			<div class="flex flex-wrap gap-8">
				<div class="flex flex-[1_1_280px] flex-col gap-3">
					<h3 class="eyebrow">Notes</h3>
					{#if data.ratings.count}
						<RatingHistogram {...data.ratings} {scale} />
					{:else}
						<p class="text-sm text-muted">Pas encore de note.</p>
					{/if}
				</div>
				{#if data.followed.length}
					<div class="flex flex-[2_1_340px] flex-col gap-3">
						<h3 class="eyebrow">Tes abonnements</h3>
						<ul class="flex flex-wrap gap-2">
							{#each data.followed as f (f.id)}
								{@const name = f.displayName || f.username}
								<li>
									<a
										href={resolve('/(app)/u/[username]', { username: f.username })}
										class="flex items-center gap-2 card rounded-full py-1 pr-3.5 pl-1 text-sm text-ink no-underline hover:border-muted"
										title="{name} · {statusLabel[f.status]}"
									>
										<Avatar src={f.avatarUrl} {name} class="size-7 text-xs" />
										<span class="font-semibold">{name}</span>
										<span class="text-muted"
											>{f.score !== null
												? `★ ${toScale(f.score, scale)}`
												: statusLabel[f.status]}</span
										>
									</a>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>

			{#if data.reviews.length}
				<div class="flex flex-col gap-3">
					<h3 class="eyebrow">Critiques</h3>
					<ul class="flex flex-col divide-y divide-line">
						{#each data.reviews as r (r.id)}
							{@const name = r.displayName || r.username}
							<li class="flex gap-3.5 py-4">
								<Avatar src={r.avatarUrl} {name} />
								<div class="min-w-0 flex-1">
									<p class="text-sm">
										<a
											href={resolve('/(app)/u/[username]', { username: r.username })}
											class="font-semibold text-ink no-underline hover:underline">{name}</a
										>
										{#if r.score !== null}<span class="text-accent-ink"
												>★ {toScale(r.score, scale)}/{scale}</span
											>{/if}
										<span class="text-muted">· {r.when}</span>
									</p>
									{#if r.reviewSpoiler}
										<details class="mt-1.5">
											<summary class="cursor-pointer text-sm text-muted"
												>Contient des spoilers · <span class="text-ink underline">Afficher</span
												></summary
											>
											<p class="mt-1.5 max-w-[70ch] whitespace-pre-line">{r.review}</p>
										</details>
									{:else}
										<p class="mt-1.5 max-w-[70ch] whitespace-pre-line">{r.review}</p>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</section>
	{/if}
</div>

{#if entry && unit && !trackingVisible && (!m.totalUnits || progress < m.totalUnits)}
	<div
		class="fixed inset-x-0 bottom-(--nav-h) z-30 flex items-center gap-3 border-t border-line bg-surface/95 px-4 pt-2.5 pb-[calc(0.625rem+var(--nav-pad))] backdrop-blur transition-[bottom] md:hidden"
	>
		{#if nextUp}
			<!-- Shows with episodes: the next one, by name -->
			<div class="flex min-w-0 flex-1 flex-col">
				<span class="text-[11px] font-bold tracking-widest text-accent-ink uppercase"
					>À voir ensuite</span
				>
				<span class="truncate text-sm font-semibold"
					>{nextUp.label} · {nextUp.title ?? `Épisode ${nextUp.number}`}</span
				>
			</div>
			<button
				type="button"
				class="btn-accent shrink-0"
				disabled={marking}
				onclick={() => mark('episode', { episodeId: nextUp.id, seen: 'true' })}>Marquer vu</button
			>
		{:else}
			<div class="flex min-w-0 flex-1 flex-col">
				<span class="truncate text-sm font-semibold">{m.title}</span>
				<span class="text-[13px] text-muted tabular-nums"
					>{progress}{m.totalUnits ? ` / ${m.totalUnits}` : ''} {unit}</span
				>
			</div>
			<button type="button" class="btn-accent shrink-0" onclick={() => setProgress(progress + 1)}
				>+1 {singular(unit)}</button
			>
		{/if}
	</div>
{/if}
