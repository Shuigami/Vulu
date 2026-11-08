<script lang="ts">
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<main class="mx-auto mt-16 max-w-sm px-4">
	<p class="mb-8 text-center text-2xl font-semibold">Vulu</p>
	{@render children()}
</main>
