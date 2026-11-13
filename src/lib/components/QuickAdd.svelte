<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Poster from '#lib/components/Poster.svelte';
	import TypeTag from '#lib/components/TypeTag.svelte';
	import {
		MEDIA_TYPES,
		statusLabel,
		typeLabel,
		typePlural,
		unitLabel,
		type EntryStatus,
		type MediaType
	} from '#lib/labels.ts';
	import { postAction, toast } from '#lib/toast.svelte.ts';

	type Entry = { status: EntryStatus; progress: number };
	type Result = {
		/** Null for a provider result not yet in the catalogue: imported when added. */
		id: number | null;
		provider?: string;
		externalId?: string;
		type: MediaType;
		title: string;
		posterUrl: string | null;
		year: number | null;
		overview: string | null;
		totalUnits: number | null;
		entry: Entry | null;
	};

	const statuses: EntryStatus[] = ['planned', 'in_progress', 'completed'];
	const unitOne: Record<MediaType, string | null> = {
		movie: null,
		tv: 'Épisode',
		anime: 'Épisode',
		manga: 'Chapitre',
		book: 'Page'
	};

	let dialog: HTMLDialogElement | undefined = $state();
	let inputs: HTMLInputElement[] = $state([]);
	let q = $state('');
	let type = $state<MediaType | null>(null);
	let results = $state<Result[]>([]);
	/** The query the results answer: the empty state waits for a real answer. */
	let answered = $state('');
	let loading = $state(false);
	/** Provider results are being fetched, after the local ones. */
	let remoteLoading = $state(false);
	let selected = $state(-1);
	let status = $state<EntryStatus>('completed');
	let progress = $state(0);
	let pending = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;

	const query = $derived(q.trim());
	const providersQuery = $derived(new URLSearchParams({ q: query }).toString());
	const current = $derived(selected >= 0 ? results[selected] : undefined);
	const unit = $derived(current ? unitOne[current.type] : null);
	const mediaHref = (r: Result) => resolve('/(app)/media/[id]', { id: String(r.id) });
	const key = (r: Result) => (r.externalId ? `${r.provider}:${r.externalId}` : r.id);
	/** Same threshold as the main search (LOCAL_ENOUGH in search.ts). */
	const LOCAL_ENOUGH = 5;

	// Phone sheet: dragged down by its top bar, closes past a distance or on a quick flick
	let drag: { y: number; t: number } | null = $state(null);
	let dragY = $state(0);
	function dragStart(e: PointerEvent) {
		if ((e.target as Element).closest('button')) return;
		drag = { y: e.clientY, t: e.timeStamp };
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
	}
	function dragMove(e: PointerEvent) {
		if (drag) dragY = Math.max(0, e.clientY - drag.y);
	}
	function dragEnd(e: PointerEvent) {
		if (!drag) return;
		const flick = dragY > 30 && dragY / (e.timeStamp - drag.t) > 0.5;
		drag = null;
		if (!dialog || (dragY < 120 && !flick)) return void (dragY = 0);
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return dialog.close();
		dragY = dialog.offsetHeight; // slide out, then close
		setTimeout(() => dialog?.close(), 300);
	}

	// The page behind must not scroll; overflow: hidden alone does not stop touch scrolling on
	// every mobile browser, so the body is pinned in place and the position restored on close
	let scrollY = 0;
	function lockScroll() {
		scrollY = window.scrollY;
		Object.assign(document.body.style, { position: 'fixed', top: `-${scrollY}px`, width: '100%' });
	}
	function unlockScroll() {
		Object.assign(document.body.style, { position: '', top: '', width: '' });
		window.scrollTo(0, scrollY);
	}

	export function open() {
		q = answered = '';
		results = [];
		selected = -1;
		dialog?.showModal();
		lockScroll();
		// Two layouts, one search field each: focus the one on screen
		inputs.find((i) => i?.offsetParent)?.focus();
	}

	function pick(i: number) {
		if (i === selected) return;
		selected = i;
		status = 'completed';
		progress = 0;
	}

	function search() {
		clearTimeout(timer);
		controller?.abort();
		remoteLoading = false;
		if (query.length < 2) {
			results = [];
			selected = -1;
			loading = false;
			return;
		}
		loading = true;
		const asked = new URLSearchParams(type ? { q: query, type } : { q: query }).toString();
		const wide = () => matchMedia('(min-width: 48rem)').matches;
		timer = setTimeout(async () => {
			const signal = (controller = new AbortController()).signal;
			try {
				const res = await fetch(`${resolve('search/quick')}?${asked}`, { signal });
				if (res.ok) {
					results = await res.json();
					answered = asked;
					// Wide screens preview the first result; phones wait for a tap
					selected = -1;
					if (wide() && results.length) pick(0);
				}
				loading = false;
				// Few local results: ask the providers too (slower, through the worker), then append
				if (!res.ok || results.length >= LOCAL_ENOUGH) return;
				remoteLoading = true;
				const remote = await fetch(`${resolve('search/quick')}?${asked}&remote`, { signal });
				if (remote.ok) {
					results = [...results, ...(await remote.json())];
					if (wide() && selected < 0 && results.length) pick(0);
				}
				remoteLoading = false;
			} catch {
				// Aborted by a newer keystroke (which keeps loading on), or offline
				if (!signal.aborted) loading = remoteLoading = false;
			}
		}, 150);
	}

	function setType(t: MediaType | null) {
		type = t;
		search();
	}

	async function add(r: Result, as: EntryStatus = status) {
		if (pending || r.entry) return;
		pending = true;
		const n = as === 'in_progress' && r.type !== 'movie' ? progress : 0;
		// A provider result is imported into the catalogue first (the worker fetches it)
		if (r.id === null) r.id = await importResult(r);
		const res =
			r.id === null
				? null
				: await postAction(`${mediaHref(r)}?/add`, { status: as, progress: n }).catch(() => null);
		const result = res?.ok ? await res.json() : null;
		pending = false;
		if (result?.type === 'success') {
			r.entry = { status: as, progress: as === 'completed' ? (r.totalUnits ?? 0) : n };
			toast(`« ${r.title} » ajouté (${statusLabel[as].toLowerCase()})`);
		} else if (result?.type === 'redirect') {
			dialog?.close();
			await goto(result.location);
		} else {
			toast('L’ajout a échoué, réessaie.');
		}
	}

	/** Imports a provider result through the search page's `open` action; returns its catalogue id. */
	async function importResult(r: Result) {
		const res = await postAction(`${resolve('search')}?/open`, {
			type: r.type,
			provider: r.provider ?? '',
			externalId: r.externalId ?? ''
		}).catch(() => null);
		const result = res?.ok ? await res.json() : null;
		const id = result?.type === 'redirect' ? /\/media\/(\d+)/.exec(result.location)?.[1] : null;
		return id ? Number(id) : null;
	}

	function onkeydown(e: KeyboardEvent) {
		const n = results.length;
		if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
			e.preventDefault();
			pick(e.key === 'ArrowDown' ? (selected + 1) % n : (selected - 1 + n) % n);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (current) add(current);
			else if (query.length >= 2 && !n && !loading) {
				dialog?.close();
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved path plus a query string
				goto(`${resolve('search')}?${providersQuery}`);
			}
		}
	}

	const entryText = (r: Result) => {
		const e = r.entry!;
		const u = unitOne[r.type];
		return e.status === 'in_progress' && u && e.progress
			? `${statusLabel[e.status]} · ${u.toLowerCase()} ${e.progress}`
			: statusLabel[e.status];
	};
	const meta = (r: Result) =>
		[r.year, r.totalUnits && unitLabel[r.type] ? `${r.totalUnits} ${unitLabel[r.type]}` : null]
			.filter(Boolean)
			.join(' · ');
</script>

{#snippet searchField(i: number, cls: string)}
	<label class="flex items-center gap-3 {cls}">
		<svg
			aria-hidden="true"
			class="shrink-0 {query ? 'text-accent' : 'text-muted'}"
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg
		>
		<input
			bind:this={inputs[i]}
			bind:value={q}
			type="search"
			autocomplete="off"
			enterkeyhint="search"
			placeholder="Quelle œuvre veux-tu ajouter ?"
			aria-label="Chercher une œuvre"
			class="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted"
			oninput={search}
			{onkeydown}
		/>
	</label>
{/snippet}

{#snippet typeChips(cls: string)}
	<div class="flex gap-2 {cls}" role="group" aria-label="Type d’œuvre">
		{#each [null, ...MEDIA_TYPES] as t (t)}
			<button
				type="button"
				aria-pressed={type === t}
				class="{type === t ? 'chip-on' : 'chip'} min-h-9 shrink-0 px-3.5"
				onclick={() => setType(t)}>{t ? typePlural[t] : 'Tout'}</button
			>
		{/each}
	</div>
{/snippet}

{#snippet emptyState()}
	{#if query.length >= 2 && answered && !loading && !remoteLoading && !results.length}
		<div class="flex flex-col items-start gap-3 p-2">
			<p class="text-sm text-muted">Rien trouvé pour « {query} ».</p>
			<a
				href="{resolve('search')}?{providersQuery}"
				class="btn-ghost text-sm"
				onclick={() => dialog?.close()}>Ouvrir la recherche complète</a
			>
		</div>
	{:else if !results.length}
		<p class="p-2 text-sm text-muted">
			{loading
				? 'Recherche…'
				: remoteLoading
					? 'Recherche chez TMDB, AniList et Open Library…'
					: 'Tape le titre d’un film, d’une série, d’un anime, d’un manga ou d’un livre.'}
		</p>
	{/if}
{/snippet}

{#snippet notFound(cls: string)}
	<p class={cls}>
		{#if remoteLoading}
			Recherche chez TMDB, AniList et Open Library…
		{:else}
			Pas trouvé ? <a href="{resolve('search')}?{providersQuery}" onclick={() => dialog?.close()}
				>Ouvrir la recherche complète</a
			>
		{/if}
	</p>
{/snippet}

<!-- Phones: a sheet from the bottom, a poster grid, tap then pick a status.
	 Wide screens: results on the left, the picked title previewed on the right.
	 Closes on Escape (native) and on a click on the backdrop. -->
<dialog
	bind:this={dialog}
	aria-label="Ajouter une œuvre"
	class="max-h-none max-w-none overflow-hidden border-line bg-surface p-0 text-ink backdrop:bg-black/60 motion-safe:transition-[translate,opacity] motion-safe:duration-300 motion-safe:ease-out max-md:fixed max-md:inset-x-0 max-md:top-12 max-md:bottom-0 max-md:m-0 max-md:h-auto max-md:w-full max-md:rounded-t-3xl max-md:border-t md:mx-auto md:mt-[7vh] md:h-[min(42rem,86vh)] md:w-[min(60rem,calc(100vw-4rem))] md:rounded-[1.25rem] md:border md:shadow-[0_32px_80px_-16px_rgb(0_0_0/0.6)] max-md:motion-safe:starting:open:translate-y-full md:motion-safe:starting:open:-translate-y-2 md:motion-safe:starting:open:opacity-0"
	style:translate={dragY ? `0 ${dragY}px` : null}
	style:transition={drag ? 'none' : null}
	onclick={(e) => e.target === dialog && dialog.close()}
	onclose={() => {
		dragY = 0;
		unlockScroll();
	}}
>
	<!-- Phones -->
	<div class="flex h-full flex-col md:hidden">
		<!-- Drag handle: pull the sheet down to close it (pointer only, "Fermer" is the accessible way) -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="shrink-0 touch-none select-none"
			onpointerdown={dragStart}
			onpointermove={dragMove}
			onpointerup={dragEnd}
			onpointercancel={dragEnd}
		>
			<div aria-hidden="true" class="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line"></div>
			<div class="flex items-center justify-between px-4 pt-2">
				<h2 class="font-display text-[22px] font-extrabold tracking-tight">Ajouter</h2>
				<button
					type="button"
					class="min-h-11 cursor-pointer px-1 font-semibold text-muted hover:text-ink"
					onclick={() => dialog?.close()}>Fermer</button
				>
			</div>
		</div>
		<div class="px-4 pt-2">
			{@render searchField(
				0,
				'h-12 rounded-2xl border border-line bg-bg px-3.5 text-base focus-within:border-accent'
			)}
		</div>
		{@render typeChips('overflow-x-auto px-4 pt-3 pb-1 [scrollbar-width:none]')}
		<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-4">
			{#if results.length}
				<ul
					class="grid grid-cols-3 gap-3 motion-safe:transition-opacity {loading
						? 'opacity-60'
						: ''}"
					aria-label="Résultats"
				>
					{#each results as r, i (key(r))}
						<li>
							<button
								type="button"
								aria-pressed={i === selected}
								class="flex w-full cursor-pointer flex-col gap-1.5 text-left"
								onclick={() => pick(i)}
							>
								<span
									class="relative block rounded-[10px] outline-2 outline-offset-2 {i === selected
										? 'outline-accent'
										: 'outline-transparent'}"
								>
									<Poster
										src={r.posterUrl}
										title={r.title}
										type={r.type}
										class="w-full rounded-[10px]"
									/>
									{#if i === selected}
										<span
											class="absolute top-1.5 right-1.5 grid size-6.5 place-items-center rounded-full bg-accent text-on-accent"
											><svg
												aria-hidden="true"
												width="14"
												height="14"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="3"
												stroke-linecap="round"
												stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"></path></svg
											></span
										>
									{/if}
									{#if r.entry}
										<span
											class="absolute bottom-1.5 left-1.5 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold text-[#7fd4b5]"
											>{statusLabel[r.entry.status]}</span
										>
									{/if}
								</span>
								<span class="truncate text-[13px] leading-tight font-semibold">{r.title}</span>
								<span class="-mt-1 text-xs text-muted"
									>{typeLabel[r.type]}{r.year ? ` · ${r.year}` : ''}</span
								>
							</button>
						</li>
					{/each}
				</ul>
				{@render notFound('pt-4 text-[13px] text-muted')}
			{:else}
				{@render emptyState()}
			{/if}
		</div>
		{#if current}
			<div
				class="flex shrink-0 flex-col gap-3 border-t border-line bg-surface-2/60 px-4 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))]"
			>
				<div class="flex items-center gap-3">
					<Poster
						src={current.posterUrl}
						title={current.title}
						type={current.type}
						class="w-9 shrink-0 rounded-md"
					/>
					<span class="flex min-w-0 flex-col">
						<span class="truncate font-bold">{current.title}</span>
						<span class="text-xs text-muted"
							>{typeLabel[current.type]}{current.year ? ` · ${current.year}` : ''}</span
						>
					</span>
				</div>
				{#if current.entry}
					<div class="flex items-center justify-between gap-3">
						<span class="text-sm font-semibold text-success"
							>Dans ta bibliothèque · {entryText(current)}</span
						>
						<a
							href={mediaHref(current)}
							class="btn-ghost shrink-0 text-sm"
							onclick={() => dialog?.close()}>Ouvrir la fiche</a
						>
					</div>
				{:else}
					<div class="grid grid-cols-3 gap-2">
						{#each statuses as s (s)}
							<button
								type="button"
								disabled={pending}
								class="{s === 'completed' ? 'btn-accent' : 'btn-ghost'} min-h-12 px-2"
								onclick={() => current && add(current, s)}>{statusLabel[s]}</button
							>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Wide screens -->
	<div class="flex h-full flex-col max-md:hidden">
		<div class="flex items-center gap-3 border-b border-line pr-3 pl-6">
			{@render searchField(1, 'h-17 flex-1 text-[19px] font-medium')}
			{#if answered && results.length}
				<span class="text-xs text-muted"
					>{results.length} résultat{results.length > 1 ? 's' : ''}</span
				>
			{/if}
			<button
				type="button"
				class="flex size-10 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
				aria-label="Fermer"
				onclick={() => dialog?.close()}
				><svg
					aria-hidden="true"
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"></path></svg
				></button
			>
		</div>
		{@render typeChips('flex-wrap border-b border-line px-6 py-3')}
		<div class="flex min-h-0 flex-1">
			<div class="flex w-95 shrink-0 flex-col overflow-y-auto border-r border-line p-2.5">
				{#if results.length}
					<ul
						role="listbox"
						aria-label="Résultats"
						class="flex flex-col gap-0.5 motion-safe:transition-opacity {loading
							? 'opacity-60'
							: ''}"
					>
						{#each results as r, i (key(r))}
							<li role="option" aria-selected={i === selected}>
								<button
									type="button"
									tabindex="-1"
									class="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left {i ===
									selected
										? 'bg-surface-2'
										: 'hover:bg-surface-2/60'}"
									onclick={() => pick(i)}
								>
									<Poster
										src={r.posterUrl}
										title={r.title}
										type={r.type}
										class="w-10 shrink-0 rounded-md"
									/>
									<span class="flex min-w-0 flex-1 flex-col gap-1">
										<span class="truncate text-sm font-semibold">{r.title}</span>
										<span class="flex items-center gap-2 text-xs text-muted"
											><TypeTag type={r.type} />{r.year ?? ''}</span
										>
									</span>
									{#if r.entry}
										<span class="text-xs font-semibold text-success">Dans ta biblio</span>
									{/if}
								</button>
							</li>
						{/each}
					</ul>
					{@render notFound('mt-auto px-2.5 pt-3 pb-1 text-[13px] text-muted')}
				{:else}
					{@render emptyState()}
				{/if}
			</div>

			<div class="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-8 pt-6 pb-6">
				{#if current}
					<div class="flex gap-6">
						<Poster
							src={current.posterUrl}
							title={current.title}
							type={current.type}
							class="w-36 shrink-0 rounded-xl"
						/>
						<div class="flex min-w-0 flex-col items-start gap-2.5">
							<TypeTag type={current.type} />
							<h2
								class="font-display text-3xl leading-[1.05] font-extrabold tracking-tight text-balance"
							>
								{current.title}
							</h2>
							{#if meta(current)}<p class="text-sm text-muted">{meta(current)}</p>{/if}
							{#if current.overview}
								<p class="line-clamp-3 max-w-[46ch] text-sm leading-relaxed text-ink/80">
									{current.overview}
								</p>
							{/if}
						</div>
					</div>

					{#if current.entry}
						<div
							class="mt-auto flex items-center justify-between gap-4 rounded-2xl bg-surface-2 p-4"
						>
							<span class="text-sm"
								><span class="font-semibold text-success">Dans ta bibliothèque</span>
								<span class="text-muted">· {entryText(current)}</span></span
							>
							<a
								href={mediaHref(current)}
								class="btn-ghost shrink-0 text-sm"
								onclick={() => dialog?.close()}>Ouvrir la fiche</a
							>
						</div>
					{:else}
						<fieldset class="flex flex-col">
							<legend class="mb-2.5 text-[13px] text-muted">Statut</legend>
							<div class="grid grid-cols-3 gap-1.5 rounded-2xl border border-line bg-bg p-1.5">
								{#each statuses as s (s)}
									<label
										class="flex min-h-11 cursor-pointer items-center justify-center rounded-xl text-sm has-focus-visible:outline-2 has-focus-visible:outline-accent {status ===
										s
											? 'bg-surface-2 font-bold text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_4px_10px_-4px_rgb(0_0_0/0.6)]'
											: 'font-semibold text-muted hover:text-ink'}"
									>
										<input
											type="radio"
											name="quick-add-status"
											value={s}
											bind:group={status}
											class="sr-only"
										/>
										{statusLabel[s]}
									</label>
								{/each}
							</div>
						</fieldset>

						{#if status === 'in_progress' && unit}
							<div class="flex items-center justify-between gap-4">
								<label for="quick-add-progress" class="text-sm text-muted">Progression</label>
								<div class="flex items-center gap-1 rounded-xl border border-line p-1">
									<button
										type="button"
										aria-label="{unit} précédent"
										class="flex h-9 w-10 cursor-pointer items-center justify-center rounded-lg bg-surface-2 text-lg font-bold disabled:opacity-40"
										disabled={progress <= 0}
										onclick={() => (progress = Math.max(0, progress - 1))}>−</button
									>
									<span class="flex items-center gap-1.5 px-2 text-sm tabular-nums">
										{unit}
										<input
											id="quick-add-progress"
											type="number"
											min="0"
											max={current.totalUnits ?? undefined}
											bind:value={progress}
											class="w-14 [appearance:textfield] rounded-md bg-transparent text-center text-base font-bold text-ink outline-none focus:bg-surface-2 [&::-webkit-inner-spin-button]:appearance-none"
										/>
										{#if current.totalUnits}<span class="text-muted">/ {current.totalUnits}</span
											>{/if}
									</span>
									<button
										type="button"
										aria-label="{unit} suivant"
										class="flex h-9 w-10 cursor-pointer items-center justify-center rounded-lg bg-surface-2 text-lg font-bold disabled:opacity-40"
										disabled={!!current.totalUnits && progress >= current.totalUnits}
										onclick={() => (progress += 1)}>+</button
									>
								</div>
							</div>
						{/if}

						<div class="mt-auto flex justify-end gap-2.5">
							{#if current.id !== null}
								<a
									href={mediaHref(current)}
									class="btn-ghost text-sm"
									onclick={() => dialog?.close()}>Voir la fiche</a
								>
							{/if}
							<button
								type="button"
								class="btn-accent"
								disabled={pending}
								onclick={() => current && add(current)}
								>{pending ? 'Ajout…' : 'Ajouter à ma bibliothèque'}
								<kbd class="font-sans text-on-accent/60" aria-hidden="true">↵</kbd></button
							>
						</div>
					{/if}
				{:else}
					<div class="m-auto max-w-[28ch] text-center text-sm text-muted">
						Choisis une œuvre à gauche pour la voir ici et l’ajouter.
					</div>
				{/if}
			</div>
		</div>
	</div>
</dialog>
