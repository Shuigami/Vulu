<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { statusLabel, type EntryStatus } from '#lib/labels.ts';

	type Rect = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>;
	type Props = {
		/** The work's title, shown at the top. */
		title: string;
		status: EntryStatus;
		/** The pressed card: the menu floats right below it, or above when there is no room. */
		anchor: Rect;
		/** The work's page ("Ouvrir la fiche"). */
		href?: string;
		/** Asked before "Terminé" (e.g. the progress jump it implies), or null to skip. */
		confirmComplete?: string | null;
		onselect: (status: EntryStatus) => void;
		onclose: () => void;
	};
	let { title, status, anchor, href, confirmComplete = null, onselect, onclose }: Props = $props();

	// Most useful first: a work being followed is paused or dropped more often than finished
	const ORDER: EntryStatus[] = ['in_progress', 'paused', 'dropped', 'completed', 'planned'];
	const choices = $derived(ORDER.filter((s) => s !== status));

	const GAP = 8;
	const MARGIN = 12;
	/** Matches the closing transition in the styles below. */
	const CLOSE_MS = 150;

	let dialog = $state<HTMLDialogElement>();
	let confirming = $state(false);
	let pos = $state<{ left: number; top: number; above: boolean } | null>(null);
	let shown = $state(false);
	let closing = $state(false);
	// Only a press that starts outside closes: the finger lifting after the long press that
	// opened the menu also clicks the backdrop
	let downOutside = false;

	/** Below the card if it fits, else above, else wherever it stays on screen. */
	function place() {
		if (!dialog) return;
		const { width, height } = dialog.getBoundingClientRect();
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

	onMount(() => {
		if (!dialog) return;
		dialog.showModal();
		place();
		// Hidden until placed, so nothing could take the focus yet
		tick().then(() => dialog?.querySelector<HTMLElement>('[data-item]')?.focus());
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
		dialog?.querySelector<HTMLElement>('[data-item]')?.focus();
	}

	// Up and down arrows move between the actions
	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		const items = [...(dialog?.querySelectorAll<HTMLElement>('[data-item]') ?? [])];
		if (!items.length) return;
		e.preventDefault();
		const i = items.indexOf(document.activeElement as HTMLElement);
		const step = e.key === 'ArrowDown' ? 1 : -1;
		items[(i + step + items.length) % items.length].focus();
	}

	const item =
		'entry-menu-item flex min-h-11 w-full cursor-pointer items-center rounded-xl px-3 text-left font-semibold text-ink no-underline hover:bg-surface-2 focus-visible:bg-surface-2 md:min-h-10';
</script>

<!-- The page scrolling behind would leave the menu away from its card -->
<svelte:window onscrollcapture={() => dismiss()} />

<!-- A small menu floating under the pressed card (above it near the bottom of the screen).
     Escape and a click outside close it. -->
<dialog
	bind:this={dialog}
	aria-labelledby="entry-menu-title"
	class="entry-menu fixed m-0 w-[min(16rem,calc(100vw-1.5rem))] max-w-none overflow-hidden rounded-2xl border border-line bg-surface p-0 text-ink shadow-[0_24px_60px_-12px_rgb(0_0_0/0.45)]"
	class:shown
	class:closing
	class:above={pos?.above}
	style:left={pos ? `${pos.left}px` : null}
	style:top={pos ? `${pos.top}px` : null}
	style:visibility={pos ? null : 'hidden'}
	onpointerdown={(e) => (downOutside = e.target === dialog)}
	onclick={(e) => {
		if (e.target === dialog && downOutside) dismiss();
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
	<div class="flex flex-col p-1.5">
		<div class="px-3 pt-2 pb-1.5">
			<p class="eyebrow">{confirming ? 'Marquer comme terminé ?' : 'Changer le statut'}</p>
			<h2 id="entry-menu-title" class="line-clamp-2 leading-tight font-semibold">{title}</h2>
		</div>
		{#if confirming}
			<p class="entry-menu-item px-3 pb-2 text-sm text-muted">{confirmComplete}</p>
			<button
				type="button"
				data-item
				class="{item} text-accent-ink"
				style:--i={1}
				onclick={() => choose('completed')}>{statusLabel.completed}</button
			>
			<button type="button" data-item class={item} style:--i={2} onclick={() => confirm(false)}
				>Retour</button
			>
		{:else}
			{#each choices as s, i (s)}
				<button type="button" data-item class={item} style:--i={i} onclick={() => choose(s)}
					>{statusLabel[s]}</button
				>
			{/each}
			{#if href}
				<div class="mx-3 my-1 border-t border-line"></div>
				<!-- eslint-disable svelte/no-navigation-without-resolve -- the caller resolves it -->
				<a
					{href}
					data-item
					class="{item} font-normal text-muted"
					style:--i={choices.length}
					onclick={() => dialog?.close()}>Ouvrir la fiche</a
				>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}
		{/if}
	</div>
</dialog>

<style>
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
	.entry-menu.shown {
		opacity: 1;
		transform: none;
	}
	.entry-menu.closing {
		opacity: 0;
		transform: scale(0.95);
		transition:
			opacity 150ms ease-in,
			transform 150ms ease-in;
	}
	/* Light veil, fading in and out with the menu */
	.entry-menu::backdrop {
		background: rgb(0 0 0 / 0.25);
		opacity: 0;
		transition: opacity 200ms ease-out;
	}
	.entry-menu.shown::backdrop {
		opacity: 1;
	}
	.entry-menu.closing::backdrop {
		opacity: 0;
		transition-duration: 150ms;
	}
	/* Actions slide in one after the other */
	.entry-menu.shown :global(.entry-menu-item) {
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
		.entry-menu::backdrop {
			transition: none;
		}
		.entry-menu.shown :global(.entry-menu-item) {
			animation: none;
		}
	}
</style>
