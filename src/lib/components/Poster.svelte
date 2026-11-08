<script lang="ts">
	// Hot-linked from the provider CDN (no re-hosting, see docs/v1-spec.md).
	let {
		src,
		title,
		class: cls = 'w-12 rounded-lg'
	}: { src: string | null; title: string; class?: string } = $props();
</script>

{#if src}
	<img
		{src}
		alt=""
		loading="lazy"
		referrerpolicy="no-referrer"
		class="{cls} aspect-[2/3] shrink-0 bg-surface-2 object-cover"
	/>
{:else}
	<div
		class="{cls} flex aspect-[2/3] shrink-0 items-end overflow-hidden bg-surface-2 p-1.5 font-display text-[11px] leading-tight font-bold text-muted"
		aria-hidden="true"
	>
		{title.slice(0, 40)}
	</div>
{/if}
