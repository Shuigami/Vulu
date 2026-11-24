<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { statusLabel, type EntryStatus } from '#lib/labels.ts';

	type Rect = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>;
	type Props = {
		/** The work's title: the menu's accessible name (the card itself stays visible). */
		title: string;
		status: EntryStatus;
		/** The pressed card: left clear of the veil, the menu floats right under it (or above). */
		anchor: Rect;
		/** The work's page ("Ouvrir la fiche"). */
		href?: string;
		/** Asked before "Terminé" (e.g. "Les épisodes 16 à 28 seront comptés comme vus."). */
		confirmComplete?: string | null;
		onselect: (status: EntryStatus) => void;
		onclose: () => void;
	};
	let { title, status, anchor, href, confirmComplete = null, onselect, onclose }: Props = $props();

	// Most common first; dropping, the one that is hard to take back, last and in red
	const ORDER: EntryStatus[] = ['in_progress', 'paused', 'completed', 'planned', 'dropped'];
	const choices = $derived(ORDER.filter((s) => s !== status));
	/** 24×24 stroke paths, one per status. */
	const ICONS: Record<EntryStatus, string> = {
		in_progress: 'M8 5.5v13l10.5-6.5z',
		paused: 'M9 6v12M15 6v12',
		completed: 'M20 6 9 17l-5-5',
		planned: 'M7 4h10v16l-5-3.5L7 20z',
		dropped: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM6.5 6.5l11 11'
	};

	const GAP = 8;
	const MARGIN = 12;
	/** Matches the closing transition in the styles below. */
	const CLOSE_MS = 150;

	let dialog = $state<HTMLDialogElement>();
	let panel = $state<HTMLDivElement>();
	let confirming = $state(false);
	let pos = $state<{ left: number; top: number; above: boolean } | null>(null);
	let shown = $state(false);
	let closing = $state(false);
	// Only a press that starts outside closes: the finger lifting after the long press that
	// opened the menu also clicks outside
	let downOutside = false;

	/** Below the card if it fits, else above, else wherever it stays on screen. */
	function place() {
		if (!panel) return;
		const { width, height } = panel.getBoundingClientRect();
		const below = anchor.bottom + GAP;
		const above = anchor.top - GAP - height;
		const fitsBelow = below + height <= innerHeight - MARGIN;
		const top =
			fitsBelow || above < MARGIN ? Math.min(below, innerHeight - MARGIN - height) : above;
		pos = {
			left: Math.max(MARGIN, Math.min(anchor.left, innerWidth - width - MARGIN)),
			top: Math.max(MARGIN, top),
			above: !fitsBelow && above >= MARGIN
		};
	}
	const focusFirst = () => panel?.querySelector<HTMLElement>('[data-item]')?.focus();

	onMount(() => {
		if (!dialog) return;
		dialog.showModal();
		place();
		// Hidden until placed, so nothing could take the focus yet
		tick().then(focusFirst);
		// Positioned first, then grown from the card's side
		requestAnimationFrame(() => requestAnimationFrame(() => (shown = true)));
		return () => dialog?.close();
	});

	/** Shrinks back toward the card, then closes. */
	function dismiss() {
		if (closing || !dialog) return;
		closing = true;
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		setTimeout(() => dialog?.close(), reduced ? 0 : CLOSE_MS);
	}

	function choose(s: EntryStatus) {
		if (s === 'completed' && confirmComplete && !confirming) return confirm(true);
		dismiss();
		onselect(s);
	}

	// The focused action is replaced: focus the first one of the new view, and stay on screen
	async function confirm(on: boolean) {
		confirming = on;
		await tick();
		place();
		focusFirst();
	}

	// Up and down arrows move between the actions
	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		const items = [...(panel?.querySelectorAll<HTMLElement>('[data-item]') ?? [])];
		if (!items.length) return;
		e.preventDefault();
		const i = items.indexOf(document.activeElement as HTMLElement);
		const step = e.key === 'ArrowDown' ? 1 : -1;
		items[(i + step + items.length) % items.length].focus();
	}
	const outside = (e: Event) =>
		e.target === dialog || (e.target as Element).hasAttribute('data-hole');

	const item =
		'entry-menu-item flex h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left text-[15px] font-semibold no-underline hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none';
</script>

<!-- The page scrolling behind would leave the menu away from its card -->
<svelte:window onscrollcapture={() => dismiss()} />

<!-- A full-screen modal: a veil with the pressed card cut out, and the menu floating under the
     card (above it near the bottom of the screen). Escape and a press outside close it. -->
<dialog
	bind:this={dialog}
	aria-label="Statut de {title}"
	class="fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 backdrop:bg-transparent"
	class:shown
	class:closing
	onpointerdown={(e) => (downOutside = outside(e))}
	onclick={(e) => {
		if (downOutside && outside(e)) dismiss();
		downOutside = false;
	}}
	oncontextmenu={(e) => e.preventDefault()}
	oncancel={(e) => {
		e.preventDefault();
		dismiss();
	}}
	{onkeydown}
	onclose={() => onclose()}
>
	<div
		data-hole
		class="entry-menu-hole absolute rounded-2xl"
		style:left="{anchor.left}px"
		style:top="{anchor.top}px"
		style:width="{anchor.right - anchor.left}px"
		style:height="{anchor.bottom - anchor.top}px"
	></div>
	<div
		bind:this={panel}
		class="entry-menu absolute w-62 rounded-[18px] border border-line bg-surface p-1.5 text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06),0_18px_48px_-12px_rgb(0_0_0/0.35)]"
		class:above={pos?.above}
		style:left={pos ? `${pos.left}px` : null}
		style:top={pos ? `${pos.top}px` : null}
		style:visibility={pos ? null : 'hidden'}
	>
		{#if confirming}
			<div class="flex flex-col gap-3.5 px-2.5 pt-2.5 pb-1">
				<div class="entry-menu-item flex flex-col gap-1.5">
					<p class="text-base font-bold">Marquer comme terminé ?</p>
					<p class="text-sm/snug text-muted">{confirmComplete}</p>
				</div>
				<div class="entry-menu-item flex gap-2" style:--i={1}>
					<button
						type="button"
						data-item
						class="h-11 flex-1 cursor-pointer rounded-xl border border-line text-[15px] font-semibold hover:bg-surface-2"
						onclick={() => confirm(false)}>Retour</button
					>
					<button
						type="button"
						data-item
						class="h-11 flex-1 cursor-pointer rounded-xl bg-accent text-[15px] font-bold text-on-accent"
						onclick={() => choose('completed')}>Terminer</button
					>
				</div>
			</div>
		{:else}
			{#each choices as s, i (s)}
				<button
					type="button"
					data-item
					class="{item} {s === 'dropped' ? 'text-danger' : 'text-ink'}"
					style:--i={i}
					onclick={() => choose(s)}
				>
					<svg
						aria-hidden="true"
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class={s === 'dropped' ? '' : 'text-muted'}><path d={ICONS[s]} /></svg
					>
					{statusLabel[s]}
				</button>
			{/each}
			{#if href}
				<div class="mx-3 my-1.5 h-px bg-line"></div>
				<!-- eslint-disable svelte/no-navigation-without-resolve -- the caller resolves it -->
				<a
					{href}
					data-item
					class="{item} font-normal text-muted"
					style:--i={choices.length}
					onclick={() => dialog?.close()}
				>
					<svg
						aria-hidden="true"
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg
					>
					Ouvrir la fiche
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}
		{/if}
	</div>
</dialog>

<style>
	/* The veil: a huge shadow around the card's box, so the card stays clear above it */
	.entry-menu-hole {
		--veil: rgb(28 26 31 / 0.22);
		box-shadow: 0 0 0 200vmax var(--veil);
		opacity: 0;
		transition: opacity 200ms ease-out;
	}
	:global([data-theme='dark']) .entry-menu-hole {
		--veil: rgb(0 0 0 / 0.45);
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) .entry-menu-hole {
			--veil: rgb(0 0 0 / 0.45);
		}
	}
	.shown .entry-menu-hole {
		opacity: 1;
	}
	.closing .entry-menu-hole {
		opacity: 0;
		transition-duration: 150ms;
	}

	/* Grows out of the card (from its top edge when above it), with a slight overshoot */
	.entry-menu {
		opacity: 0;
		transform: translateY(-6px) scale(0.92);
		transform-origin: 1.5rem top;
		transition:
			opacity 160ms ease-out,
			transform 260ms cubic-bezier(0.34, 1.4, 0.64, 1);
	}
	.entry-menu.above {
		transform: translateY(6px) scale(0.92);
		transform-origin: 1.5rem bottom;
	}
	.shown .entry-menu {
		opacity: 1;
		transform: none;
	}
	.closing .entry-menu {
		opacity: 0;
		transform: scale(0.95);
		transition:
			opacity 150ms ease-in,
			transform 150ms ease-in;
	}
	/* Actions slide in one after the other */
	.shown :global(.entry-menu-item) {
		animation: entry-menu-item 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
		animation-delay: calc(40ms + var(--i, 0) * 30ms);
	}
	@keyframes entry-menu-item {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.entry-menu,
		.entry-menu-hole {
			transition: none;
		}
		.shown :global(.entry-menu-item) {
			animation: none;
		}
	}
</style>
