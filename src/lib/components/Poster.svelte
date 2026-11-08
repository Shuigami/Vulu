<script lang="ts">
	// Hot-linked from the provider CDN (no re-hosting, see docs/v1-spec.md).
	let {
		src,
		title,
		size = 'sm'
	}: { src: string | null; title: string; size?: 'sm' | 'lg' } = $props();
	const box = $derived(size === 'lg' ? 'w-40 h-60' : 'w-12 h-18');
</script>

{#if src}
	<img
		{src}
		alt=""
		loading="lazy"
		referrerpolicy="no-referrer"
		class="{box} shrink-0 rounded bg-gray-100 object-cover"
	/>
{:else}
	<div
		class="{box} flex shrink-0 items-center justify-center rounded bg-gray-100 p-1 text-center text-[10px] text-gray-400"
		aria-hidden="true"
	>
		{title.slice(0, 30)}
	</div>
{/if}
