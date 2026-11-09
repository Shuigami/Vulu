<script lang="ts">
	let {
		src,
		name,
		class: cls = 'size-9'
	}: { src: string | null; name: string; class?: string } = $props();
</script>

{#if src}
	<img
		{src}
		alt=""
		referrerpolicy="no-referrer"
		class="{cls} shrink-0 rounded-full bg-surface-2 object-cover"
	/>
{:else}
	<span
		class="{cls} grid shrink-0 place-items-center rounded-full bg-surface-2 font-display font-bold text-muted uppercase"
		aria-hidden="true">{name.slice(0, 1)}</span
	>
{/if}
