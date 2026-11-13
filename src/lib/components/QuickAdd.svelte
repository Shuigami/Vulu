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
	let added = $state<Record<number, boolean>>({});
	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;

	export function open() {
		q = '';
		suggestions = [];
		added = {};
		dialog?.showModal();
		input?.focus();
	}

	function suggest() {
		clearTimeout(timer);
		controller?.abort();
		const query = q.trim();
		if (query.length < 2) return void (suggestions = []);
		timer = setTimeout(async () => {
			controller = new AbortController();
			try {
				const res = await fetch(
					`${resolve('search/suggest')}?${new URLSearchParams({ q: query })}`,
					{ signal: controller.signal }
				);
				if (res.ok) suggestions = await res.json();
			} catch {
				// Aborted by a newer keystroke, or offline
			}
		}, 150);
	}

	async function add(s: Suggestion) {
		const media = resolve('/(app)/media/[id]', { id: String(s.id) });
		const res = await postAction(`${media}?/add`, { status }).catch(() => null);
		const result = res?.ok ? await res.json() : null;
		if (result?.type === 'success') {
			added[s.id] = true;
			toast(`« ${s.title} » ajouté (${statusLabel[status].toLowerCase()})`);
		} else if (result?.type === 'redirect') {
			dialog?.close();
			await goto(result.location);
		} else {
			toast('L’ajout a échoué, réessaie.');
		}
	}
</script>

<!-- Closes on Escape (native) and on a click on the backdrop -->
<dialog
	bind:this={dialog}
	aria-labelledby="quick-add-title"
	class="m-auto w-[min(32rem,calc(100vw-2rem))] card p-0 text-ink shadow-xl backdrop:bg-black/60"
	onclick={(e) => e.target === dialog && dialog.close()}
>
	<div class="flex flex-col gap-4 p-5">
		<div class="flex items-center justify-between gap-3">
			<h2 id="quick-add-title" class="text-lg font-semibold">Ajouter une œuvre</h2>
			<button
				type="button"
				class="flex size-9 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
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
		<input
			bind:this={input}
			bind:value={q}
			type="search"
			autocomplete="off"
			placeholder="Film, série, anime, manga, livre…"
			aria-label="Chercher une œuvre"
			class="field text-sm"
			oninput={suggest}
		/>
		<fieldset class="flex flex-wrap items-center gap-2">
			<legend class="sr-only">Ajouter comme</legend>
			{#each statuses as s (s)}
				<label
					class="cursor-pointer has-focus-visible:ring-2 has-focus-visible:ring-accent {status === s
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

		{#if suggestions.length}
			<ul class="flex flex-col gap-1" aria-label="Résultats">
				{#each suggestions as s (s.id)}
					<li class="flex items-center gap-3 rounded-lg p-1.5 hover:bg-surface-2">
						<Poster
							src={s.posterUrl}
							title={s.title}
							type={s.type}
							class="w-9 shrink-0 rounded-md"
						/>
						<span class="flex min-w-0 flex-1 flex-col gap-0.5">
							<span class="truncate text-sm font-semibold">{s.title}</span>
							<span class="flex items-center gap-2 text-xs text-muted"
								><TypeTag type={s.type} />{s.year ?? ''}</span
							>
						</span>
						{#if added[s.id]}
							<span class="px-2 text-[13px] text-muted">Ajouté ✓</span>
						{:else}
							<button
								type="button"
								class="btn-ghost text-sm"
								aria-label="Ajouter {s.title}"
								onclick={() => add(s)}>Ajouter</button
							>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if q.trim().length >= 2}
			<a
				href="{resolve('search')}?{new URLSearchParams({ q: q.trim() })}"
				class="text-[13px] text-muted"
				onclick={() => dialog?.close()}>Pas trouvé ? Chercher chez TMDB, AniList et Open Library</a
			>
		{/if}
	</div>
</dialog>
