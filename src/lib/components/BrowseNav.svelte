<script lang="ts">
	// Previous / next work of the row the media page was opened from (#97), for keyboards and
	// mice: the ← / → keys, and arrows in the margins of wide screens. Phones swipe (`use:swipe`).
	import { neighbours, preloadNeighbours, step } from '#lib/browse.svelte.ts';

	let { mediaId }: { mediaId: number } = $props();
	const around = $derived(neighbours(mediaId));
	let busy = false;

	$effect(() => preloadNeighbours(mediaId));

	async function go(dir: 1 | -1) {
		if (busy) return;
		busy = true;
		await step(mediaId, dir).catch(() => false);
		busy = false;
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
		// Arrows move the caret in fields, and the value of sliders and selects
		const target = e.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [contenteditable], [role="slider"]')) return;
		const dir = e.key === 'ArrowRight' ? 1 : -1;
		if (!(dir === 1 ? around.next : around.prev)) return;
		e.preventDefault();
		void go(dir);
	}

	const arrow =
		'fixed top-1/2 z-30 hidden size-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-line bg-surface/90 text-ink shadow-lg backdrop-blur hover:border-muted [@media(hover:hover)_and_(min-width:80rem)]:flex';
</script>

<svelte:window {onkeydown} />

{#if around.prev}
	<button
		type="button"
		class="{arrow} left-4"
		aria-label="Œuvre précédente : {around.prev.title}"
		title={around.prev.title}
		onclick={() => go(-1)}
		><svg
			aria-hidden="true"
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2.2"
			stroke-linecap="round"
			stroke-linejoin="round"><path d="m15 18-6-6 6-6"></path></svg
		></button
	>
{/if}
{#if around.next}
	<button
		type="button"
		class="{arrow} right-4"
		aria-label="Œuvre suivante : {around.next.title}"
		title={around.next.title}
		onclick={() => go(1)}
		><svg
			aria-hidden="true"
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2.2"
			stroke-linecap="round"
			stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg
		></button
	>
{/if}
