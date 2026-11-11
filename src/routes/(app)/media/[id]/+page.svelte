<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Avatar from '#lib/components/Avatar.svelte';
	import Poster from '#lib/components/Poster.svelte';
	import RatingHistogram from '#lib/components/RatingHistogram.svelte';
	import Progress from '#lib/components/Progress.svelte';
	import TypeTag from '#lib/components/TypeTag.svelte';
	import {
		ENTRY_STATUSES,
		releaseStatusLabel,
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
	const scale = $derived(data.user.ratingScale);
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
	let hovered = $state(0);
	const rated = $derived(score == null ? 0 : Math.round((score / scale) * 10));
	const halves = $derived(hovered || rated);
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
		!!entry && !!m.totalUnits && m.totalUnits <= 200 && ['tv', 'anime', 'manga'].includes(m.type)
	);
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
	const zone = 'flex flex-col gap-2.5 bg-surface px-6 py-5';
	const zoneLabel = 'text-[13px] text-muted';
</script>

<svelte:head><title>{m.title} · Vulu</title></svelte:head>

<svelte:window
	onscroll={closeMenu}
	onresize={closeMenu}
	onclick={(e) => {
		if (moreMenu?.open && !e.composedPath().includes(moreMenu)) closeMenu();
	}}
	onkeydown={(e) => e.key === 'Escape' && closeMenu()}
/>

<div class="flex flex-col gap-10">
	<div class="flex flex-col">
		{#if m.backdropUrl}
			<!-- The bottom fades into the page so the poster and title sit on it -->
			<div class="relative overflow-hidden rounded-3xl">
				<img
					src={m.backdropUrl}
					alt=""
					referrerpolicy="no-referrer"
					class="h-44 w-full bg-surface-2 object-cover sm:h-80"
				/>
				<div
					class="absolute inset-0 bg-linear-to-t from-bg via-bg/30 via-35% to-transparent"
					aria-hidden="true"
				></div>
			</div>
		{/if}
		<section
			class="flex flex-wrap items-start gap-x-10 gap-y-6 {m.backdropUrl ? '-mt-20 sm:-mt-44' : ''}"
		>
			<Poster
				src={m.posterUrl}
				title={m.title}
				type={m.type}
				class="w-36 rounded-2xl sm:w-60 {m.backdropUrl
					? 'ml-4 border-4 border-bg shadow-xl sm:ml-8'
					: ''}"
			/>
			<div class="flex min-w-0 flex-[1_1_420px] flex-col gap-3.5 {m.backdropUrl ? 'md:pt-48' : ''}">
				<div class="flex flex-wrap items-center gap-2">
					<TypeTag type={m.type} />
					{#if m.status}<span
							class="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted"
							>{releaseStatusLabel[m.status]}</span
						>{/if}
				</div>
				<h1
					class="font-display text-[32px] leading-[1.05] font-extrabold tracking-tight text-balance sm:text-[48px]"
				>
					{m.title}
				</h1>
				<p class="text-muted">
					{[
						m.originalTitle !== m.title ? m.originalTitle : null,
						year,
						m.totalUnits && unit ? `${m.totalUnits} ${unit}` : null,
						m.runtimeMinutes ? `${m.runtimeMinutes} min` : null,
						makers.slice(0, 2).join(', ')
					]
						.filter(Boolean)
						.join(' · ')}
				</p>
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
			class="flex flex-wrap items-center gap-x-7 gap-y-4 card rounded-[22px] px-6 py-5"
		>
			<div class="flex-[1_1_260px]">
				<h2 class="h2 text-xl">Ajouter à ma bibliothèque</h2>
				<p class="text-sm text-muted">Choisis directement où tu en es.</p>
			</div>
			<div class="flex flex-wrap gap-2">
				<button name="status" value="planned" class="btn-accent px-5">{statusLabel.planned}</button>
				<button name="status" value="in_progress" class="btn-ghost"
					>{statusLabel.in_progress}</button
				>
				<button name="status" value="completed" class="btn-ghost"
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
				}}
			onchange={save}
			class="overflow-hidden card rounded-[22px]"
		>
			<h2 class="sr-only">Mon suivi</h2>
			<input type="hidden" name="entryId" value={entry.id} />
			<div class="flex flex-wrap gap-px bg-line">
				<label class="{zone} flex-[1_1_200px]">
					<span class={zoneLabel}>Statut</span>
					<select name="status" value={entry.status} class="field font-semibold">
						{#each ENTRY_STATUSES as s (s)}
							<option value={s}>{statusLabel[s]}</option>
						{/each}
					</select>
				</label>

				{#if unit}
					<div class="{zone} flex-[3_1_380px]">
						<div class="flex flex-wrap items-baseline justify-between gap-3">
							<label for="progress" class={zoneLabel}>Progression · {unit}</label>
							{#if m.totalUnits && progress < m.totalUnits}
								<span class="text-[13px] text-muted"
									>Prochain : <strong class="text-ink">{singular(unit)} {progress + 1}</strong
									></span
								>
							{/if}
						</div>
						<div class="flex flex-wrap items-center gap-4">
							<p
								class="flex items-baseline font-display text-[40px] leading-none font-extrabold tabular-nums"
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
								{#if m.totalUnits}<span class="text-[22px] font-semibold text-muted"
										>&nbsp;/ {m.totalUnits}</span
									>{/if}
							</p>
							{#if m.totalUnits}
								<div class="flex min-w-36 flex-1 flex-col gap-1.5">
									<Progress value={progress} max={m.totalUnits} label="Progression" />
									<span class="text-xs text-muted"
										>{Math.round((progress / m.totalUnits) * 100)} %{#if progress < m.totalUnits}
											· reste {m.totalUnits - progress}
											{unit}{#if m.runtimeMinutes}, environ {duration(
													(m.totalUnits - progress) * m.runtimeMinutes
												)}{/if}{/if}</span
									>
								</div>
							{/if}
							<div class="flex gap-2">
								<button
									type="button"
									class="btn-ghost w-12 px-0 text-xl"
									aria-label="Retirer un"
									onclick={() => setProgress(progress - 1)}>−</button
								>
								<button type="button" class="btn-accent" onclick={() => setProgress(progress + 1)}
									>+1 {singular(unit)}</button
								>
							</div>
						</div>
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

				<div class="{zone} flex-[1_1_220px]">
					<label for="score" class={zoneLabel}>Ma note</label>
					<div class="flex items-center gap-3">
						<div
							class="flex text-line"
							role="group"
							aria-label="Note en étoiles"
							onmouseleave={() => (hovered = 0)}
						>
							{#each [1, 2, 3, 4, 5] as i (i)}
								{@const fill = Math.min(2, Math.max(0, halves - 2 * (i - 1)))}
								<!-- Star i: a grey star, the accent star clipped to 0, 50 or 100 %, and two
									 invisible half buttons on top (left = i - 0.5, right = i) -->
								<span class="relative block size-[30px] p-0.5">
									{#each [false, true] as accent (accent)}
										<span
											class="absolute inset-0.5 overflow-hidden {accent ? 'text-accent' : ''}"
											style:width={accent ? `${(fill / 2) * 26}px` : undefined}
											><svg
												aria-hidden="true"
												width="26"
												height="26"
												viewBox="0 0 24 24"
												fill="currentColor"
												class="max-w-none"
												><polygon
													points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3"
												></polygon></svg
											></span
										>
									{/each}
									{#each [2 * i - 1, 2 * i] as h (h)}
										<button
											type="button"
											class="absolute inset-y-0 w-1/2 cursor-pointer rounded {h % 2
												? 'left-0'
												: 'right-0'}"
											aria-label="{String(h / 2).replace('.', ',')} étoile{h >= 4 ? 's' : ''} sur 5"
											aria-pressed={h === rated}
											onmouseenter={() => (hovered = h)}
											onclick={() => rate(h)}
										></button>
									{/each}
								</span>
							{/each}
						</div>
						<p class="flex items-baseline font-display text-[26px] font-extrabold">
							<input
								id="score"
								name="score"
								type="number"
								min="0"
								max={scale}
								step={scale === 100 ? 1 : 0.5}
								bind:value={score}
								placeholder="–"
								class="w-[3ch] rounded-lg bg-transparent text-right outline-offset-4 placeholder:text-muted"
							/>
							<span class="text-[15px] font-semibold text-muted">/{scale}</span>
						</p>
					</div>
					<div class="flex gap-2">
						<label
							class="btn-ghost min-h-10 flex-1 bg-surface text-[13px] has-checked:border-anime has-focus-visible:outline-2 has-focus-visible:outline-accent"
						>
							<input
								name="isFavorite"
								type="checkbox"
								checked={entry.isFavorite}
								class="peer sr-only"
							/>
							<svg
								aria-hidden="true"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="2"
								class="fill-none text-muted peer-checked:fill-current peer-checked:text-anime"
								><path
									d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"
								></path></svg
							>
							Favori
						</label>
						<details bind:this={moreMenu}>
							<summary
								aria-label="Plus d’options"
								class="btn-ghost min-h-10 w-11 list-none bg-surface px-0 [&::-webkit-details-marker]:hidden"
								onclick={(e) => {
									const r = e.currentTarget.getBoundingClientRect();
									menuAt = { top: r.bottom + 8, right: innerWidth - r.right };
								}}
							>
								<svg
									aria-hidden="true"
									width="18"
									height="18"
									viewBox="0 0 24 24"
									fill="currentColor"
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
				</div>
			</div>

			{#if !unit}<input type="hidden" name="progress" value={entry.progress} />{/if}
			{#if !secondary}<input
					type="hidden"
					name="progressSecondary"
					value={entry.progressSecondary}
				/>{/if}

			<div
				class="flex flex-wrap items-center gap-x-7 gap-y-2 border-t border-line bg-bg/50 px-6 py-3 text-[13px] text-muted"
			>
				<label class="flex items-center gap-2">
					Commencé le
					<input
						name="startedOn"
						type="date"
						value={entry.startedOn ?? ''}
						class="field min-h-9 px-2 text-[13px]"
					/>
				</label>
				<label class="flex items-center gap-2">
					Terminé le
					<input
						name="completedOn"
						type="date"
						value={entry.completedOn ?? ''}
						class="field min-h-9 px-2 text-[13px]"
					/>
				</label>
				{#if data.minutesSpent}
					<span
						><strong class="text-ink">{duration(data.minutesSpent)}</strong>
						{m.type === 'manga' || m.type === 'book' ? 'de lecture' : 'regardées'}</span
					>
				{/if}
				{#if form?.error}<p role="alert" class="text-danger">{form.error}</p>{/if}
				{#if form?.saved}<p role="status" class="text-success">Enregistré.</p>{/if}
			</div>
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

			<section aria-labelledby="info-title" class="flex flex-col gap-3.5">
				<h2 id="info-title" class="h2">Fiche</h2>
				<dl class="card px-4.5 py-1">
					{#each facts as [k, v] (k)}
						<div class="flex justify-between gap-4 border-b border-line py-2.75 text-sm">
							<dt class="text-muted">{k}</dt>
							<dd class="text-right font-semibold">{v}</dd>
						</div>
					{/each}
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
								<p class="mt-1.5 max-w-[70ch] whitespace-pre-line">{r.review}</p>
							</div>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</section>
</div>

{#if entry && unit && !trackingVisible && (!m.totalUnits || progress < m.totalUnits)}
	<div
		class="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-3 border-t border-line bg-surface/95 px-4 py-2.5 backdrop-blur md:hidden"
	>
		<div class="flex min-w-0 flex-1 flex-col">
			<span class="truncate text-sm font-semibold">{m.title}</span>
			<span class="text-[13px] text-muted tabular-nums"
				>{progress}{m.totalUnits ? ` / ${m.totalUnits}` : ''} {unit}</span
			>
		</div>
		<button type="button" class="btn-accent shrink-0" onclick={() => setProgress(progress + 1)}
			>+1 {singular(unit)}</button
		>
	</div>
{/if}
