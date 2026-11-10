<script lang="ts">
	// Same sizes as MediaShelf, so the content replaces it without moving the page.
	let { label }: { label: string } = $props();
</script>

<ul class="-mx-1 flex gap-3.5 overflow-hidden px-1 pb-2" aria-label={label} aria-busy="true">
	{#each { length: 10 }, i (i)}
		<li class="flex w-[118px] shrink-0 flex-col gap-2 sm:w-[132px]" aria-hidden="true">
			<div class="aspect-[2/3] w-full shimmer rounded-[10px]"></div>
			<div class="h-3.5 w-4/5 shimmer rounded"></div>
			<div class="h-3 w-1/2 shimmer rounded"></div>
		</li>
	{/each}
</ul>
