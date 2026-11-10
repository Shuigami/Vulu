<script lang="ts">
	let {
		value,
		max,
		label,
		release
	}: {
		value: number;
		max: number | null;
		label: string;
		/** Units coming out (first and last, 1-based), drawn as a faint segment behind the progress. */
		release?: [number, number];
	} = $props();
	const pct = (n: number) => (max ? Math.min(100, Math.max(0, (n / max) * 100)) : 0);
	// Rounded at both ends, except where it touches what was seen: it then starts at 0, under the
	// progress, so no gap shows between the two rounded ends
	const segment = $derived(
		release && { from: value >= release[0] - 1 ? 0 : release[0] - 1, to: release[1] }
	);
</script>

<div
	role="progressbar"
	aria-label={label}
	aria-valuenow={value}
	aria-valuemin={0}
	aria-valuemax={max ?? undefined}
	class="relative h-1.5 overflow-hidden rounded-full bg-line"
>
	{#if segment}
		<div
			class="absolute inset-y-0 rounded-full bg-[repeating-linear-gradient(135deg,color-mix(in_oklab,var(--c-accent)_55%,transparent)_0_3px,color-mix(in_oklab,var(--c-accent)_20%,transparent)_3px_6px)]"
			style:left="{pct(segment.from)}%"
			style:width="{pct(segment.to - segment.from)}%"
		></div>
	{/if}
	<div
		class="relative h-full rounded-full bg-accent motion-safe:transition-[width] motion-safe:duration-300"
		style:width="{pct(value)}%"
	></div>
</div>
