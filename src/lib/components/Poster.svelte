<script lang="ts">
	import type { MediaType } from '#lib/labels.ts';

	// Hot-linked from the provider CDN (no re-hosting, see docs/v1-spec.md).
	let {
		src,
		title,
		type,
		class: cls = 'w-12 rounded-lg',
		delay = 0
	}: {
		src: string | null;
		title: string;
		type?: MediaType;
		class?: string;
		/** Delay of the fade-in (ms), to reveal a row one poster after the other. */
		delay?: number;
	} = $props();

	// Fades in once loaded. Without a delay, images already loaded (cached, or before
	// hydration) show at once; without JavaScript nothing is hidden.
	function fadeIn(img: HTMLImageElement) {
		if (img.complete && !delay) return;
		img.style.opacity = '0';
		img.style.transitionDelay = `${delay}ms`;
		// Next frame, so the transition starts from 0 even for a cached image
		const show = () =>
			requestAnimationFrame(() => {
				img.style.opacity = '';
				// The delay would also hold back the hover frame afterwards
				setTimeout(() => (img.style.transitionDelay = ''), delay + 300);
			});
		if (img.complete) {
			show();
			return;
		}
		img.addEventListener('load', show, { once: true });
		img.addEventListener('error', show, { once: true });
	}
</script>

{#if src}
	<img
		{src}
		alt=""
		loading="lazy"
		referrerpolicy="no-referrer"
		use:fadeIn
		class="{cls} aspect-[2/3] shrink-0 bg-surface-2 object-cover motion-safe:transition-opacity motion-safe:duration-300"
	/>
{:else}
	<div
		class="{cls} flex aspect-[2/3] shrink-0 items-end overflow-hidden bg-surface-2 p-1.5 font-display text-[11px] leading-tight font-bold text-muted"
		style:background-image={type
			? `linear-gradient(160deg, color-mix(in oklab, var(--c-${type}) 40%, var(--c-surface-2)), var(--c-surface-2) 75%)`
			: undefined}
		aria-hidden="true"
	>
		{title.slice(0, 40)}
	</div>
{/if}
