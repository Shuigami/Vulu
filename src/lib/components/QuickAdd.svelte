<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Poster from '#lib/components/Poster.svelte';
	import TypeTag from '#lib/components/TypeTag.svelte';
	import { statusLabel, type EntryStatus, type MediaType } from '#lib/labels.ts';
	import { postAction, toast } from '#lib/toast.svelte.ts';

	type Suggestion = {
		id: number;
		type: MediaType;
		title: string;
		posterUrl: string | null;
		year: number | null;
	};

	const statuses: EntryStatus[] = ['planned', 'in_progress', 'completed'];

	let dialog: HTMLDialogElement | undefined = $state();
	let input: HTMLInputElement | undefined = $state();
	let q = $state('');
	let status = $state<EntryStatus>('planned');
	let suggestions = $state<Suggestion[]>([]);
	/** The query the current suggestions answer: the empty state waits for a real answer. */
	let answered = $state('');
	let loading = $state(false);
	let active = $state(-1);
	let rows = $state<Record<number, 'pending' | 'added'>>({});
	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;

	const query = $derived(q.trim());
	const providersQuery = $derived(new URLSearchParams({ q: query }).toString());

	export function open() {
		q = answered = '';
		suggestions = [];
		rows = {};
		active = -1;
		dialog?.showModal();
		input?.focus();
	}

	function suggest() {
		clearTimeout(timer);
		controller?.abort();
		active = -1;
		if (query.length < 2) {
			suggestions = [];
			loading = false;
			return;
		}
		loading = true;
		const asked = query;
		timer = setTimeout(async () => {
			controller = new AbortController();
			try {
				const res = await fetch(
					`${resolve('search/suggest')}?${new URLSearchParams({ q: asked })}`,
					{ signal: controller.signal }
				);
				if (res.ok) {
					suggestions = await res.json();
					answered = asked;
				}
				loading = false;
			} catch {
				// Aborted by a newer keystroke (which keeps loading on), or offline
				if (!controller.signal.aborted) loading = false;
			}
		}, 150);
	}

	async function add(s: Suggestion) {
		if (rows[s.id]) return;
		rows[s.id] = 'pending';
		const media = resolve('/(app)/media/[id]', { id: String(s.id) });
		const res = await postAction(`${media}?/add`, { status }).catch(() => null);
		const result = res?.ok ? await res.json() : null;
		if (result?.type === 'success') {
			rows[s.id] = 'added';
			toast(`« ${s.title} » ajouté (${statusLabel[status].toLowerCase()})`);
			return;
		}
		delete rows[s.id];
		if (result?.type === 'redirect') {
			dialog?.close();
			await goto(result.location);
		} else {
			toast('L’ajout a échoué, réessaie.');
		}
	}

	function onkeydown(e: KeyboardEvent) {
		const n = suggestions.length;
		if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
			e.preventDefault();
			active = e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (active >= 0) add(suggestions[active]);
			else if (query.length >= 2 && !n && !loading) {
				dialog?.close();
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved path plus a query string
				goto(`${resolve('search')}?${providersQuery}`);
			}
		}
	}
</script>

<!-- Anchored near the top, not centred: the panel does not jump as results arrive or as a
	 phone keyboard opens. Closes on Escape (native) and on a click on the backdrop. -->
<dialog
	bind:this={dialog}
	aria-labelledby="quick-add-title"
	class="mx-auto mt-[max(1rem,12vh)] max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain card p-0 text-ink shadow-[0_24px_60px_-12px_rgb(0_0_0/0.45)] backdrop:bg-black/55 motion-safe:transition-[opacity,translate] motion-safe:duration-200 motion-safe:ease-out motion-safe:starting:open:-translate-y-2 motion-safe:starting:open:opacity-0"
	onclick={(e) => e.target === dialog && dialog.close()}
>
	<div class="flex flex-col gap-5 p-5 sm:p-6">
		<div class="flex items-center justify-between gap-3">
			<h2 id="quick-add-title" class="font-display text-xl font-bold tracking-tight">
				Ajouter une œuvre
			</h2>
			<button
				type="button"
				class="-mr-2 flex size-10 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
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

		<div class="flex flex-col gap-3">
			<!-- Same field as the header search -->
			<label
				class="flex h-12 items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 focus-within:border-accent"
			>
				<svg
					aria-hidden="true"
					class="shrink-0 text-muted"
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg
				>
				<input
					bind:this={input}
					bind:value={q}
					type="search"
					autocomplete="off"
					enterkeyhint="search"
					placeholder="Film, série, anime, manga, livre…"
					aria-label="Chercher une œuvre"
					role="combobox"
					aria-expanded={suggestions.length > 0}
					aria-controls="quick-add-results"
					aria-autocomplete="list"
					aria-activedescendant={active >= 0 ? `quick-add-${active}` : undefined}
					class="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
					oninput={suggest}
					{onkeydown}
				/>
			</label>
			<fieldset class="flex flex-wrap items-center gap-2">
				<legend class="mb-2 text-[13px] text-muted">Ajouter comme</legend>
				{#each statuses as s (s)}
					<label
						class="min-h-9 cursor-pointer px-3.5 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent {status ===
						s
							? 'chip-on'
							: 'chip'}"
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
			</fieldset>
		</div>

		<div class="-mx-2 -mb-2 border-t border-line pt-3">
			{#if suggestions.length}
				<ul
					id="quick-add-results"
					role="listbox"
					aria-label="Résultats"
					class="flex flex-col motion-safe:transition-opacity {loading ? 'opacity-60' : ''}"
				>
					{#each suggestions as s, i (s.id)}
						{@const row = rows[s.id]}
						<li
							id="quick-add-{i}"
							role="option"
							aria-selected={i === active}
							class="flex items-center gap-3 rounded-xl p-2 {i === active ? 'bg-surface-2' : ''}"
							onmouseenter={() => (active = i)}
						>
							<Poster
								src={s.posterUrl}
								title={s.title}
								type={s.type}
								class="w-10 shrink-0 rounded-md"
							/>
							<a
								href={resolve('/(app)/media/[id]', { id: String(s.id) })}
								class="flex min-w-0 flex-1 flex-col gap-1 text-ink no-underline"
								tabindex="-1"
								onclick={() => dialog?.close()}
							>
								<span class="truncate text-sm font-semibold">{s.title}</span>
								<span class="flex items-center gap-2 text-xs text-muted"
									><TypeTag type={s.type} />{s.year ?? ''}</span
								>
							</a>
							{#if row === 'added'}
								<span
									class="flex min-h-9 min-w-24 items-center justify-center gap-1.5 text-[13px] font-semibold text-success"
									><svg
										aria-hidden="true"
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2.4"
										stroke-linecap="round"
										stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"></path></svg
									>Ajouté</span
								>
							{:else}
								<button
									type="button"
									class="btn-ghost min-h-9 min-w-24 px-3.5 text-sm"
									aria-label="Ajouter {s.title}"
									disabled={row === 'pending'}
									onclick={() => add(s)}>{row === 'pending' ? 'Ajout…' : 'Ajouter'}</button
								>
							{/if}
						</li>
					{/each}
				</ul>
				<p class="px-2 pt-2 pb-2 text-[13px] text-muted">
					Pas trouvé ? <a
						href="{resolve('search')}?{providersQuery}"
						onclick={() => dialog?.close()}>Chercher chez TMDB, AniList et Open Library</a
					>
				</p>
			{:else if query.length >= 2 && answered === query && !loading}
				<div class="flex flex-col items-start gap-3 px-2 pt-1 pb-2">
					<p class="text-sm text-muted">Rien dans le catalogue Vulu pour « {query} ».</p>
					<a
						href="{resolve('search')}?{providersQuery}"
						class="btn-ghost text-sm"
						onclick={() => dialog?.close()}>Chercher chez TMDB, AniList et Open Library</a
					>
				</div>
			{:else}
				<p class="px-2 pt-1 pb-2 text-sm text-muted">
					{loading ? 'Recherche…' : 'Les œuvres déjà sur Vulu s’affichent ici pendant la saisie.'}
				</p>
			{/if}
		</div>
	</div>
</dialog>
