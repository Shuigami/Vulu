<script lang="ts">
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	// Decorative stand-ins for posters (no network call on the sign-in page).
	const tiles = ['#3b4a6b', '#6b3b4a', '#2f5d50', '#6a5530', '#4b3b6b', '#5a4636'];
</script>

<div class="flex min-h-screen flex-wrap">
	<section
		aria-hidden="true"
		class="relative flex min-h-64 flex-[1_1_520px] flex-col justify-between overflow-hidden bg-surface p-8 sm:p-12"
	>
		<p class="font-display text-[34px] font-extrabold tracking-tight">
			vulu<span class="text-accent">.</span>
		</p>
		<div class="-mx-10 my-8 grid -rotate-6 grid-cols-4 gap-3.5 max-sm:hidden">
			{#each [...tiles, ...tiles].slice(0, 12) as tint, i (i)}
				<div class="aspect-[2/3] rounded-xl" style:background={tint}></div>
			{/each}
		</div>
		<p
			class="max-w-[16ch] font-display text-[28px] leading-tight font-bold tracking-tight sm:text-[34px]"
		>
			Films, séries, anime, mangas et livres. Une seule bibliothèque.
		</p>
	</section>
	<main class="flex flex-[1_1_420px] items-center justify-center px-6 py-12">
		<div class="flex w-full max-w-sm flex-col gap-6">
			<div class="flex justify-end"><ThemeToggle /></div>
			{@render children()}
		</div>
	</main>
</div>
