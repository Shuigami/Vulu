<script lang="ts">
	let { value, max, label }: { value: number; max: number | null; label: string } = $props();
	const pct = $derived(max ? Math.min(100, Math.round((value / max) * 100)) : 0);
</script>

<div
	role="progressbar"
	aria-label={label}
	aria-valuenow={value}
	aria-valuemin={0}
	aria-valuemax={max ?? undefined}
	class="h-1.5 overflow-hidden rounded-full bg-line"
>
	<div class="h-full rounded-full bg-accent" style:width="{pct}%"></div>
</div>
