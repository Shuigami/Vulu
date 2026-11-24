<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { statusLabel, type EntryStatus } from '#lib/labels.ts';
	import type { PressPoint } from '#lib/longpress.ts';

	type Props = {
		/** The work's title, shown at the top. */
		title: string;
		status: EntryStatus;
		/** Where the menu opened (wide screens show it there; phones get a sheet). */
		at: PressPoint;
		/** The work's page ("Ouvrir la fiche"). */
		href?: string;
		/** Asked before "Terminé" (e.g. the progress jump it implies), or null to skip. */
		confirmComplete?: string | null;
		onselect: (status: EntryStatus) => void;
		onclose: () => void;
	};
	let { title, status, at, href, confirmComplete = null, onselect, onclose }: Props = $props();

	// Most useful first: a work being followed is paused or dropped more often than finished
	const ORDER: EntryStatus[] = ['in_progress', 'paused', 'dropped', 'completed', 'planned'];
	const choices = $derived(ORDER.filter((s) => s !== status));

	let dialog = $state<HTMLDialogElement>();
	let confirming = $state(false);
	let pos = $state<{ left: number; top: number } | null>(null);
	// The finger lifting right after a long press must not count as a click on the backdrop
	let openedAt = 0;

	onMount(() => {
		if (!dialog) return;
		dialog.showModal();
		openedAt = performance.now();
		// Wide screens: a popover at the press, kept inside the viewport
		if (matchMedia('(min-width: 48rem)').matches) {
			const { width, height } = dialog.getBoundingClientRect();
			const margin = 8;
			pos = {
				left: Math.max(margin, Math.min(at.x, innerWidth - width - margin)),
				top: Math.max(margin, Math.min(at.y, innerHeight - height - margin))
			};
		}
		return () => dialog?.close();
	});

	function choose(s: EntryStatus) {
		if (s === 'completed' && confirmComplete && !confirming) return confirm(true);
		dialog?.close();
		onselect(s);
	}

	// The focused action is replaced: focus the first one of the new view
	async function confirm(on: boolean) {
		confirming = on;
		await tick();
		dialog?.querySelector<HTMLElement>('[data-item]')?.focus();
	}

	// Up and down arrows move between the actions
	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		const items = [...(dialog?.querySelectorAll<HTMLElement>('[data-item]') ?? [])];
		if (!items.length) return;
		e.preventDefault();
		const i = items.indexOf(document.activeElement as HTMLElement);
		const step = e.key === 'ArrowDown' ? 1 : -1;
		items[(i + step + items.length) % items.length].focus();
	}

	const item =
		'flex min-h-12 w-full cursor-pointer items-center rounded-xl px-3 text-left font-semibold text-ink no-underline hover:bg-surface-2 focus-visible:bg-surface-2 md:min-h-10';
</script>

<!-- Phones: a sheet from the bottom. Wide screens: a small popover where the card was pressed.
     Escape closes (native), so does a click on the backdrop. -->
<dialog
	bind:this={dialog}
	aria-labelledby="entry-menu-title"
	class="max-h-none max-w-none border-line bg-surface p-0 text-ink backdrop:bg-black/50 motion-safe:transition-[translate,opacity] motion-safe:duration-200 motion-safe:ease-out max-md:fixed max-md:inset-x-0 max-md:top-auto max-md:bottom-0 max-md:m-0 max-md:w-full max-md:rounded-t-3xl max-md:border-t max-md:pb-[max(1rem,env(safe-area-inset-bottom))] md:fixed md:m-0 md:w-64 md:rounded-2xl md:border md:shadow-[0_24px_60px_-12px_rgb(0_0_0/0.5)] md:backdrop:bg-transparent max-md:motion-safe:starting:open:translate-y-full md:motion-safe:starting:open:opacity-0"
	style:left={pos ? `${pos.left}px` : null}
	style:top={pos ? `${pos.top}px` : null}
	onclick={(e) => e.target === dialog && performance.now() - openedAt > 400 && dialog.close()}
	oncontextmenu={(e) => e.preventDefault()}
	{onkeydown}
	onclose={() => onclose()}
>
	<div class="flex flex-col gap-1 p-2 max-md:px-3">
		<div
			aria-hidden="true"
			class="mx-auto mt-0.5 mb-1 h-1.5 w-10 rounded-full bg-line md:hidden"
		></div>
		<div class="px-3 pt-1 pb-2">
			<p class="eyebrow">{confirming ? 'Marquer comme terminé ?' : 'Changer le statut'}</p>
			<h2 id="entry-menu-title" class="line-clamp-2 leading-tight font-semibold">{title}</h2>
		</div>
		{#if confirming}
			<p class="px-3 pb-2 text-sm text-muted">{confirmComplete}</p>
			<button
				type="button"
				data-item
				class="{item} text-accent-ink"
				onclick={() => choose('completed')}>{statusLabel.completed}</button
			>
			<button type="button" data-item class={item} onclick={() => confirm(false)}>Retour</button>
		{:else}
			{#each choices as s (s)}
				<button type="button" data-item class={item} onclick={() => choose(s)}
					>{statusLabel[s]}</button
				>
			{/each}
			{#if href}
				<div class="mx-3 my-1 border-t border-line"></div>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller resolves it -->
				<a {href} data-item class="{item} font-normal text-muted" onclick={() => dialog?.close()}
					>Ouvrir la fiche</a
				>
			{/if}
		{/if}
		<button
			type="button"
			class="{item} justify-center font-normal text-muted md:hidden"
			onclick={() => dialog?.close()}>Fermer</button
		>
	</div>
</dialog>
