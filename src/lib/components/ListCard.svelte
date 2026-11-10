<script lang="ts">
	import { resolve } from '$app/paths';

	let {
		list
	}: {
		list: { id: number; name: string; count: number; posters: string[]; visibility: string };
	} = $props();
</script>

<a
	href={resolve('/(app)/lists/[id]', { id: String(list.id) })}
	class="group flex flex-col gap-2.5 text-ink no-underline"
>
	<div
		class="grid aspect-[4/3] grid-cols-4 gap-0.5 overflow-hidden rounded-xl bg-surface-2 tile-frame"
	>
		{#each [0, 1, 2, 3] as i (i)}
			{#if list.posters[i]}
				<img src={list.posters[i]} alt="" loading="lazy" class="h-full w-full object-cover" />
			{:else}
				<span class="bg-surface-2"></span>
			{/if}
		{/each}
	</div>
	<div>
		<p class="leading-snug font-semibold group-hover:underline">{list.name}</p>
		<p class="mt-0.5 text-[13px] text-muted">
			{list.count}
			{list.count > 1 ? 'œuvres' : 'œuvre'}{list.visibility === 'public' ? '' : ' · privée'}
		</p>
	</div>
</a>
