<script lang="ts">
	import { toScale } from '#lib/labels.ts';

	// Scores are stored out of 100; buckets[i] counts scores from i*10 to i*10+9 (100 in the last).
	let {
		buckets,
		count,
		average,
		scale
	}: { buckets: number[]; count: number; average: number | null; scale: number } = $props();
	const max = $derived(Math.max(1, ...buckets));
	const range = (i: number) =>
		`${toScale(i * 10, scale)} à ${toScale(i === 9 ? 100 : i * 10 + 9, scale)}`;
</script>

<div class="flex items-end gap-5">
	<div class="flex flex-1 flex-col gap-1">
		<div class="flex h-16 items-end gap-[3px]">
			{#each buckets as n, i (i)}
				<div
					class="flex-1 rounded-t-[3px] {n ? 'bg-accent' : 'bg-surface-2'}"
					style:height="{Math.max(4, (n / max) * 100)}%"
					role="img"
					aria-label="{n} note{n > 1 ? 's' : ''} de {range(i)}"
					title="{n} · {range(i)}"
				></div>
			{/each}
		</div>
		<!-- Axis ends: lowest and highest score -->
		<div class="flex justify-between text-[11px] text-muted tabular-nums" aria-hidden="true">
			<span>{toScale(0, scale)}</span><span>{scale}</span>
		</div>
	</div>
	<div class="text-right">
		<p class="font-display text-[32px] leading-none font-bold">
			{average === null ? '–' : toScale(average, scale)}<span
				class="text-base font-semibold text-muted">/{scale}</span
			>
		</p>
		<p class="mt-1 text-[13px] whitespace-nowrap text-muted">
			{count} note{count > 1 ? 's' : ''}
		</p>
	</div>
</div>
