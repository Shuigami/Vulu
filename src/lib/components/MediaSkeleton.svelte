<!-- Placeholder of the media page, shown while a work loads or is imported from its provider.
     It repeats the page's own containers and classes (src/routes/(app)/media/[id]/+page.svelte)
     for a work with a backdrop, not yet in the library, so nothing moves when it is replaced.
     Line boxes use the page's line heights. The bar is simulated: it slows down towards 90 %. -->
<div class="fixed inset-x-0 top-0 z-50 h-1" aria-hidden="true">
	<div class="loading-bar h-full bg-accent"></div>
</div>
<p class="sr-only" role="status">Chargement de l’œuvre…</p>

<div class="flex flex-col gap-6 sm:gap-10" aria-hidden="true">
	<div class="flex flex-col">
		<div
			class="relative overflow-hidden rounded-3xl max-sm:-mx-4 max-sm:-mt-10 max-sm:rounded-none"
		>
			<div class="h-52 w-full shimmer sm:h-80"></div>
		</div>
		<section
			class="relative -mt-14 flex items-start gap-x-4 gap-y-6 sm:-mt-44 sm:flex-wrap sm:gap-x-10"
		>
			<div
				class="aspect-[2/3] w-28 shrink-0 shimmer rounded-xl border-4 border-bg shadow-xl max-sm:order-last sm:ml-8 sm:w-60 sm:rounded-2xl"
			></div>
			<div
				class="flex min-w-0 flex-1 flex-col gap-2.5 pt-8 sm:flex-[1_1_420px] sm:gap-3.5 sm:pt-0 md:pt-48"
			>
				<div class="flex gap-2">
					<div class="h-5 w-14 shimmer rounded-md"></div>
					<div class="h-5 w-28 shimmer rounded-md"></div>
				</div>
				<!-- Title: two lines of 26 px on phones, one line of 48 px above -->
				<div class="flex flex-col gap-1 sm:gap-0">
					<div class="h-[27px] w-11/12 shimmer rounded-lg sm:h-[50px] sm:w-3/5"></div>
					<div class="h-6 w-1/2 shimmer rounded-lg sm:hidden"></div>
				</div>
				<div class="h-[23px] w-4/5 shimmer rounded sm:w-1/2"></div>
				<div class="flex gap-1.5">
					{#each [64, 60, 72] as w (w)}
						<div class="h-[30px] shimmer rounded-full" style:width="{w}px"></div>
					{/each}
				</div>
			</div>
		</section>
	</div>

	<!-- Same box as the "Ajouter à ma bibliothèque" card -->
	<div class="flex flex-wrap items-center gap-x-7 gap-y-4 card rounded-[22px] px-6 py-5">
		<div class="flex flex-[1_1_260px] flex-col gap-1">
			<div class="h-[26px] w-56 shimmer rounded-lg"></div>
			<div class="h-[18px] w-44 shimmer rounded"></div>
		</div>
		<div class="flex gap-2">
			{#each [76, 88, 84] as w (w)}
				<div class="h-11 shimmer rounded-xl" style:width="{w}px"></div>
			{/each}
		</div>
	</div>

	<div class="flex flex-wrap items-start gap-x-12 gap-y-10">
		<div class="flex min-w-0 flex-[999_1_560px] flex-col gap-10">
			<div class="flex flex-col gap-3">
				<div class="h-[33px] w-32 shimmer rounded-lg"></div>
				<div class="flex max-w-[64ch] flex-col gap-2">
					{#each [100, 96, 98, 90, 60] as w (w)}
						<div class="h-[14.5px] shimmer rounded" style:width="{w}%"></div>
					{/each}
				</div>
			</div>
		</div>
		<div class="flex min-w-0 flex-[1_1_320px] flex-col gap-3.5">
			<div class="h-[33px] w-36 shimmer rounded-lg"></div>
			<div class="h-14 card"></div>
		</div>
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
