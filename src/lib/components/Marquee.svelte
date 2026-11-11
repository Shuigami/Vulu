<script lang="ts">
	import type { Snippet } from 'svelte';

	/** One line of text; when it overflows it waits, scrolls to its end, waits, and comes back. */
	let { children, class: cls = '' }: { children: Snippet; class?: string } = $props();

	let outer: HTMLElement | undefined = $state();
	let inner: HTMLElement | undefined = $state();
	let shift = $state(0);

	$effect(() => {
		if (!outer || !inner) return;
		const measure = () => (shift = Math.max(0, inner!.scrollWidth - outer!.clientWidth));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(outer);
		return () => observer.disconnect();
	});
</script>

<p bind:this={outer} class="overflow-hidden whitespace-nowrap {cls}">
	<span
		bind:this={inner}
		class="inline-block {shift ? 'marquee' : ''}"
		style:--shift="-{shift}px"
		style:--duration="{5 + shift / 25}s">{@render children()}</span
	>
</p>
