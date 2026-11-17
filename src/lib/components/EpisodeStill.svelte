<script lang="ts">
	// Episode image, hot-linked from the TMDB CDN; a plain 16:9 tile when there is none.
	let { src, class: cls = 'rounded-lg' }: { src: string | null; class?: string } = $props();
</script>

{#if src}
	<img
		{src}
		alt=""
		loading="lazy"
		referrerpolicy="no-referrer"
		class="aspect-video w-full bg-surface-2 object-cover {cls}"
	/>
{:else}
	<div class="aspect-video w-full bg-surface-2 {cls}"></div>
{/if}
