<script lang="ts">
	/** Five stars counted in halves: `rated` is 0 (not rated) to 10 half-stars. */
	let {
		rated,
		onrate,
		size = 30
	}: { rated: number; onrate: (halves: number) => void; size?: number } = $props();

	let hovered = $state(0);
	const halves = $derived(hovered || rated);
</script>

<div
	class="flex text-line"
	role="group"
	aria-label="Note en étoiles"
	onmouseleave={() => (hovered = 0)}
>
	{#each [1, 2, 3, 4, 5] as i (i)}
		{@const fill = Math.min(2, Math.max(0, halves - 2 * (i - 1)))}
		<!-- Star i: a grey star, the accent star clipped to 0, 50 or 100 %, and two
			 invisible half buttons on top (left = i - 0.5, right = i) -->
		<span class="relative block p-0.5" style:width="{size}px" style:height="{size}px">
			{#each [false, true] as accent (accent)}
				<span
					class="absolute inset-0.5 overflow-hidden {accent ? 'text-accent' : ''}"
					style:width={accent ? `calc((100% - 4px) * ${fill / 2})` : undefined}
					><svg
						aria-hidden="true"
						viewBox="0 0 24 24"
						fill="currentColor"
						class="max-w-none"
						width={size - 4}
						height={size - 4}
						><polygon
							points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3"
						></polygon></svg
					></span
				>
			{/each}
			{#each [2 * i - 1, 2 * i] as h (h)}
				<button
					type="button"
					class="absolute inset-y-0 w-1/2 cursor-pointer rounded {h % 2 ? 'left-0' : 'right-0'}"
					aria-label="{String(h / 2).replace('.', ',')} étoile{h >= 4 ? 's' : ''} sur 5"
					aria-pressed={h === rated}
					onmouseenter={() => (hovered = h)}
					onclick={() => onrate(h)}
				></button>
			{/each}
		</span>
	{/each}
</div>
