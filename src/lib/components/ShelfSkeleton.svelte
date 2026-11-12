<script lang="ts">
	// Same sizes as MediaShelf, so the content replaces it without moving the page: caption
	// rows use the same line height (two title lines, then `noteLines`), and ten cards always
	// overflow, so the horizontal scrollbar is there from the start too.
	let { label, noteLines = 1 }: { label: string; noteLines?: number } = $props();
	const bar = 'shimmer block h-2.5 rounded';
</script>

<ul
	class="-mx-2 flex [scrollbar-width:thin] gap-3.5 overflow-x-auto px-2 pb-2"
	aria-label={label}
	aria-busy="true"
>
	{#each { length: 10 }, i (i)}
		<li class="flex w-[118px] shrink-0 flex-col gap-2 sm:w-[132px]" aria-hidden="true">
			<div class="aspect-[2/3] w-full shimmer rounded-[10px]"></div>
			<div class="flex flex-col gap-0.5 text-[13px] leading-tight">
				<span class="flex h-[2lh] flex-col justify-around"
					><span class="{bar} w-4/5"></span><span class="{bar} w-1/2"></span></span
				>
				<span class="flex flex-col justify-center" style:height="{noteLines}lh"
					><span class="{bar} w-2/5 opacity-70"></span></span
				>
			</div>
		</li>
	{/each}
</ul>
