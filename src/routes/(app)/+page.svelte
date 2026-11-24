<script lang="ts">
	import { untrack } from 'svelte';
	import { flip } from 'svelte/animate';
	import type { TransitionConfig } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { deserialize, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ActivityFeed from '#lib/components/ActivityFeed.svelte';
	import EntryMenu from '#lib/components/EntryMenu.svelte';
	import Marquee from '#lib/components/Marquee.svelte';
	import MediaShelf from '#lib/components/MediaShelf.svelte';
	import Poster from '#lib/components/Poster.svelte';
	import Progress from '#lib/components/Progress.svelte';
	import ShelfSkeleton from '#lib/components/ShelfSkeleton.svelte';
	import StartHere from '#lib/components/StartHere.svelte';
	import TypeTag from '#lib/components/TypeTag.svelte';
	import {
		MEDIA_TYPES,
		statusLabel,
		toScale,
		typePlural,
		unitLabel,
		type EntryStatus
	} from '#lib/labels.ts';
	import { haptic } from '#lib/haptics.ts';
	import { longpress, type PressPoint } from '#lib/longpress.ts';
	import { postAction, toast, toastError } from '#lib/toast.svelte.ts';
	import { seasonPosition } from '#lib/seasons.ts';
	import type { DiscoverItem } from '#lib/server/discover.ts';
	import type { StatusUndo } from '#lib/server/library.ts';
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
	// A card whose status changed leaves the row: it shrinks away while the others glide over
	const leave: (node: Element) => TransitionConfig = () =>
		matchMedia('(prefers-reduced-motion: reduce)').matches
			? { duration: 0 }
			: {
					duration: 280,
					easing: cubicOut,
					css: (t: number) => `opacity: ${t}; transform: scale(${0.85 + 0.15 * t})`
				};
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
	// +1 shown before the server answers, until the page data is reloaded
	let bumped = $state<Record<number, number>>({});
	const singular = { épisodes: 'épisode', chapitres: 'chapitre', pages: 'page' } as Record<
		string,
		string
	>;
	const scale = $derived(data.ratingScale);

	// Long press (right click, "⋯") on a "Reprendre" card: change its status from here
	type Resume = (typeof data.entries)[number];
	let menu = $state<{ entry: Resume; at: PressPoint; returnTo: HTMLElement | null } | null>(null);
	// Hidden at once, until the reload confirms they left "En cours" (or brings them back)
	let removed = $state<Record<number, true>>({});
	const resume = $derived(data.entries.filter((e) => !removed[e.id]));

	function openMenu(entry: Resume, at: PressPoint) {
		const card = document.querySelector<HTMLElement>(`[data-entry="${entry.id}"]`);
		const focused = document.activeElement;
		menu = {
			entry,
			at,
			returnTo:
				focused instanceof HTMLElement && card?.contains(focused)
					? focused
					: (card?.querySelector('a') ?? null)
		};
		if (at.via === 'touch') haptic('tap');
	}
	function closeMenu() {
		const m = menu;
		menu = null;
		// Keyboard and mouse: back to the card (a finger does not need the focus ring)
		if (m && m.at.via !== 'touch' && !removed[m.entry.id])
			m.returnTo?.focus({ preventScroll: true });
	}
	// "Terminé" fills the progress: asked first when that counts many units as seen
	const completeJump = (e: Resume) => {
		const unit = unitLabel[e.type];
		if (!unit || !e.totalUnits || e.progress >= e.totalUnits) return null;
		return `Ta progression passera de ${e.progress} à ${e.totalUnits} ${unit}, comptés comme vus dans tes statistiques.`;
	};
	async function post(action: string, fields: Record<string, string | number>) {
		const result = deserialize(await (await postAction(action, fields)).text());
		if (result.type !== 'success') throw new Error(`${action} failed`);
		return result.data;
	}
	async function setStatus(e: Resume, status: EntryStatus) {
		removed[e.id] = true;
		try {
			const { undo } = (await post('?/status', { entryId: e.id, status })) as { undo: StatusUndo };
			toast(`« ${e.title} » : ${statusLabel[status].toLowerCase()}`, () => restore(e, undo));
			await invalidateAll();
		} catch {
			toastError('Le statut n’a pas pu être changé.');
		}
		delete removed[e.id];
	}
	async function restore(e: Resume, undo: StatusUndo) {
		try {
			await post('?/undoStatus', { entryId: e.id, undo: JSON.stringify(undo) });
		} catch {
			toastError('L’annulation a échoué.');
		}
		await invalidateAll();
	}
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

	{#if data.recap}
		<a
			href={resolve('recap')}
			class="group relative isolate flex flex-wrap items-center justify-between gap-x-6 gap-y-2 overflow-hidden card rounded-[22px] px-6 py-5 text-ink no-underline"
		>
			<span
				aria-hidden="true"
				class="absolute -top-10 -right-6 -z-10 size-40 rounded-full bg-accent/30 blur-2xl"
			></span>
			<span class="flex flex-col">
				<span class="eyebrow">{data.recap.open ? 'C’est sorti' : 'Bientôt'}</span>
				<span class="font-display text-2xl font-extrabold">Ton Récap {data.recap.year}</span>
			</span>
			<span class="font-semibold text-accent-ink group-hover:underline">
				{#if data.recap.open}
					Découvrir ton année →
				{:else if data.recap.days <= 1}
					Demain →
				{:else}
					Dans {data.recap.days} jours, le {data.recap.release} →
				{/if}
			</span>
		</a>
	{/if}

	{#if data.user}
		<section aria-labelledby="resume" class="flex flex-col gap-2.5 sm:gap-4">
			<h2 id="resume" class="h2">Reprendre</h2>
			{#if resume.length}
				<!-- One scrollable row, like the shelves below; the padding keeps card shadows visible -->
				<ul
					class="-mx-2 -mt-2 flex snap-x scroll-px-2 [scrollbar-width:thin] gap-4 overflow-x-auto px-2 pt-2 pb-2"
				>
					{#each resume as e (e.id)}
						{@const unit = unitLabel[e.type]}
						{@const progress = bumped[e.id] ?? e.progress}
						{@const position = seasonPosition(e.seasons, progress)}
						{@const href = resolve('/(app)/media/[id]', { id: String(e.mediaId) })}
						<!-- The whole card opens the work (a link covers it), except the +1 button. The link is
						     not the title: the scrolling title's transform would shrink its click area.
						     A long press (right click, "⋯") opens the status menu instead; no native callout. -->
						<li
							animate:glide
							transition:leave
							data-entry={e.id}
							use:longpress={{ onpress: (at) => openMenu(e, at) }}
							class="group relative flex w-[min(340px,85vw)] shrink-0 snap-start gap-4 card p-3.5 tile-frame select-none [-webkit-touch-callout:none]"
						>
							<a {href} draggable="false" class="absolute inset-0 rounded-2xl"
								><span class="sr-only">{e.title}</span></a
							>
							<!-- Mouse and keyboard: shown on hover or focus. Touch: the long press (kept for screen readers) -->
							<button
								type="button"
								aria-haspopup="dialog"
								aria-label="Changer le statut de {e.title}"
								class="absolute top-2 right-2 z-10 grid size-8 cursor-pointer place-items-center rounded-full bg-surface text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-surface-2 hover:text-ink pointer-coarse:sr-only"
								onclick={(ev) => {
									const box = ev.currentTarget.getBoundingClientRect();
									openMenu(e, {
										x: box.left,
										y: box.bottom + 4,
										via: ev.detail === 0 ? 'keyboard' : 'mouse'
									});
								}}
								><svg
									aria-hidden="true"
									width="18"
									height="18"
									viewBox="0 0 24 24"
									fill="currentColor"
									><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle
										cx="19"
										cy="12"
										r="2"
									/></svg
								></button
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
											{#if position}
												<!-- Series: the season being watched, not the whole show -->
												<Progress
													value={position.seen}
													max={position.count}
													label="Progression de {e.title}, saison {position.season}"
												/>
												<p class="text-[13px] text-muted tabular-nums">
													<span class="font-semibold text-ink">S{position.season}</span> · Ép.
													{#key progress}<strong in:pop class="inline-block font-semibold text-ink"
															>{position.seen}</strong
														>{/key} / {position.count}
												</p>
											{:else}
												{#if e.totalUnits}
													<Progress
														value={progress}
														max={e.totalUnits}
														label="Progression de {e.title}"
													/>
												{/if}
												<p class="text-[13px] text-muted tabular-nums">
													{#key progress}<strong in:pop class="inline-block font-semibold text-ink"
															>{progress}</strong
														>{/key}{e.totalUnits ? ` / ${e.totalUnits}` : ''}
													{unit}
												</p>
											{/if}
										</div>
										<form
											class="relative z-10"
											method="post"
											action="?/increment"
											use:enhance={() => {
												// Shown at once; the reload brings the saved value (or the old one back)
												pending = e.id;
												bumped[e.id] = progress + 1;
												return async ({ update, result }) => {
													if (result.type === 'success') {
														await update();
														haptic('success');
													} else toastError('La progression n’a pas pu être enregistrée.');
													pending = null;
													delete bumped[e.id];
												};
											}}
										>
											<input type="hidden" name="entryId" value={e.id} />
											<button
												disabled={pending === e.id}
												aria-busy={pending === e.id}
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
		{#if menu}
			{@const e = menu.entry}
			<EntryMenu
				title={e.title}
				status={e.status}
				at={menu.at}
				href={resolve('/(app)/media/[id]', { id: String(e.mediaId) })}
				confirmComplete={completeJump(e)}
				onselect={(s) => setStatus(e, s)}
				onclose={closeMenu}
			/>
		{/if}
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
									{#if w.season}
										<!-- Series: the season coming out, not the whole show -->
										<Progress
											value={w.season.seen}
											max={w.season.count}
											release={w.season.release}
											label="Progression de {w.mediaTitle}, saison {w.season.number}"
										/>
									{:else if w.totalUnits}
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
										{#if w.season}<span class="shrink-0 tabular-nums"
												>S{w.season.number} ·
												<strong class="font-semibold text-ink">{w.season.seen}</strong> / {w.season
													.count} vus</span
											>
										{:else if w.totalUnits}<span class="shrink-0 tabular-nums"
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
