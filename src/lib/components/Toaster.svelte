<script lang="ts">
	import { fly } from 'svelte/transition';
	import { dismiss, toasts } from '#lib/toast.svelte.ts';

	const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
</script>

<!-- Above the mobile tab bar and the media page +1 bar, in the corner on wider screens -->
<div
	role="status"
	aria-live="polite"
	class="pointer-events-none fixed inset-x-4 bottom-36 z-50 flex flex-col items-center gap-2 md:inset-x-auto md:right-6 md:bottom-6 md:items-end"
>
	{#each toasts as t (t.id)}
		<div
			transition:fly={{ y: 16, duration: reduced() ? 0 : 200 }}
			class="pointer-events-auto flex min-h-12 max-w-full items-center gap-4 rounded-xl bg-ink py-2 pr-2 pl-4 text-sm text-bg shadow-xl"
		>
			<span>{t.message}</span>
			{#if t.undo}
				<button
					type="button"
					class="min-h-9 cursor-pointer rounded-lg px-3 font-semibold text-accent hover:bg-bg/10"
					onclick={() => {
						dismiss(t.id);
						t.undo?.();
					}}>Annuler</button
				>
			{/if}
		</div>
	{/each}
</div>
