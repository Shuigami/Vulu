<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Poster from '#lib/components/Poster.svelte';
	import TypeTag from '#lib/components/TypeTag.svelte';
	import type { MediaType } from '#lib/labels.ts';

	type Suggestion = {
		id: number;
		type: MediaType;
		title: string;
		posterUrl: string | null;
		year: number | null;
	};

	let { class: cls = '' }: { class?: string } = $props();

	let input: HTMLInputElement | undefined = $state();
	let q = $derived(
		page.url.pathname === resolve('search') ? (page.url.searchParams.get('q') ?? '') : ''
	);
	let suggestions = $state<Suggestion[]>([]);
	let open = $state(false);
	let focused = $state(false);
	let active = $state(-1);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;

	const href = (s: Suggestion) => resolve('/(app)/media/[id]', { id: String(s.id) });

	function suggest() {
		clearTimeout(timer);
		controller?.abort();
		active = -1;
		const query = q.trim();
		if (query.length < 2) return void (suggestions = []);
		timer = setTimeout(async () => {
			controller = new AbortController();
			try {
				const res = await fetch(
					`${resolve('search/suggest')}?${new URLSearchParams({ q: query })}`,
					{
						signal: controller.signal
					}
				);
				if (res.ok) suggestions = await res.json();
			} catch {
				// Aborted by a newer keystroke, or offline: the form still works on Enter
			}
		}, 150);
	}

	function onkeydown(e: KeyboardEvent) {
		if (!open || !suggestions.length) return;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const n = suggestions.length;
			active = e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n;
		} else if (e.key === 'Enter' && active >= 0) {
			e.preventDefault();
			open = false;
			goto(href(suggestions[active]));
		} else if (e.key === 'Escape') {
			open = false;
		}
	}

	// "/" focuses the search from anywhere, except while typing in a field
	function onWindowKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
		if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
		e.preventDefault();
		input?.focus();
		input?.select();
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

<form
	action={resolve('search')}
	method="get"
	role="search"
	class="relative flex h-11 min-w-0 items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 focus-within:border-accent {cls}"
	onsubmit={() => (open = false)}
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
		name="q"
		autocomplete="off"
		placeholder="Film, série, anime, manga, livre…"
		aria-label="Rechercher"
		role="combobox"
		aria-expanded={open && suggestions.length > 0}
		aria-controls="search-suggestions"
		aria-autocomplete="list"
		aria-activedescendant={active >= 0 ? `suggestion-${active}` : undefined}
		class="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
		oninput={() => {
			open = true;
			suggest();
		}}
		onfocus={() => (open = focused = true)}
		onblur={() => (open = focused = false)}
		{onkeydown}
	/>
	{#if !q && !focused}
		<kbd
			class="hidden rounded-md border border-line px-1.5 font-sans text-xs text-muted md:block"
			title="Raccourci : /"
			aria-hidden="true">/</kbd
		>
	{/if}

	{#if open && suggestions.length}
		<!-- mousedown is prevented so the input keeps focus until the click lands -->
		<ul
			id="search-suggestions"
			role="listbox"
			aria-label="Suggestions"
			class="absolute inset-x-0 top-full z-40 mt-2 flex flex-col card p-1.5 shadow-xl"
			onmousedown={(e) => e.preventDefault()}
		>
			{#each suggestions as s, i (s.id)}
				<li id="suggestion-{i}" role="option" aria-selected={i === active}>
					<a
						href={href(s)}
						class="flex items-center gap-3 rounded-lg p-1.5 text-ink no-underline hover:bg-surface-2 {i ===
						active
							? 'bg-surface-2'
							: ''}"
						onclick={() => (open = false)}
					>
						<Poster src={s.posterUrl} title={s.title} type={s.type} class="w-8 rounded-md" />
						<span class="flex min-w-0 flex-col gap-0.5">
							<span class="truncate text-sm font-semibold">{s.title}</span>
							<span class="flex items-center gap-2 text-xs text-muted"
								><TypeTag type={s.type} />{s.year ?? ''}</span
							>
						</span>
					</a>
				</li>
			{/each}
			<li role="presentation" class="mt-1 border-t border-line pt-1">
				<!-- A link, not a submit button: Enter would pick it as the form's default button and
					 the submission would break as the list closes -->
				<a
					href="{resolve('search')}?{new URLSearchParams({ q: q.trim() })}"
					class="block rounded-lg px-2.5 py-2 text-sm text-muted no-underline hover:bg-surface-2 hover:text-ink"
					onclick={() => (open = false)}>Tous les résultats pour « {q.trim()} »</a
				>
			</li>
		</ul>
	{/if}
</form>
