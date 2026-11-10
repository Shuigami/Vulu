<!-- Placeholder of the media page, shown while a work loads or is imported from its provider.
     The bar is simulated: it slows down towards 90 % and the page replaces it when ready. -->
<div class="fixed inset-x-0 top-0 z-50 h-1" aria-hidden="true">
	<div class="loading-bar h-full bg-accent"></div>
</div>
<p class="sr-only" role="status">Chargement de l’œuvre…</p>

<div class="flex flex-wrap items-start gap-12" aria-hidden="true">
	<div class="flex min-w-0 flex-[999_1_560px] flex-wrap gap-8">
		<div class="aspect-[2/3] w-44 shimmer self-start rounded-2xl sm:w-60"></div>
		<div class="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">
			<div class="h-6 w-16 shimmer rounded-full"></div>
			<div class="flex flex-col gap-2.5 py-1">
				<div class="h-8 w-4/5 shimmer rounded-lg sm:h-10"></div>
				<div class="h-8 w-1/2 shimmer rounded-lg sm:h-10"></div>
			</div>
			<div class="h-4 w-56 shimmer rounded"></div>
			<div class="mt-2 flex max-w-[62ch] flex-col gap-2.5">
				{#each [100, 96, 98, 90, 60] as w (w)}
					<div class="h-3.5 shimmer rounded" style:width="{w}%"></div>
				{/each}
			</div>
		</div>
	</div>

	<div class="flex flex-[1_1_340px] flex-col gap-5 card rounded-[20px] p-6">
		<div class="h-6 w-40 shimmer rounded-lg"></div>
		<div class="h-4 w-3/4 shimmer rounded"></div>
		<div class="h-11 shimmer rounded-xl"></div>
	</div>
</div>

<style>
	.loading-bar {
		animation: loading 8s cubic-bezier(0.1, 0.7, 0.3, 1) forwards;
	}
	@keyframes loading {
		from {
			width: 0;
		}
		to {
			width: 90%;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.loading-bar {
			animation: none;
			width: 90%;
			opacity: 0.6;
		}
	}
</style>
