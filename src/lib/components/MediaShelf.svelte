<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { SvelteMap } from 'svelte/reactivity';
	import Poster from '#lib/components/Poster.svelte';
	import type { MediaType } from '#lib/labels.ts';
	import { opening } from '#lib/opening.svelte.ts';

	/** A work in the catalogue (`mediaId`) or a provider result, imported when opened. */
	type Item = {
		key: string;
		title: string;
		posterUrl: string | null;
		type: string;
		mediaId: number | null;
		provider?: string;
		externalId?: string;
		/** Small line under the title. */
		note?: string;
	};
	let { items, label }: { items: Item[]; label: string } = $props();
	// Room for the hover frame (2 px outline, 2 px offset): the padding keeps it unclipped and
	// scroll-padding keeps the snap from pushing the first poster against the edge
	const caption = 'flex flex-col gap-0.5 text-left text-[13px] leading-tight';

	// Posters load only once their card nears the visible part of the row, so the visible ones
	// are not slowed down by the rest. Each card gets its rank in the batch that came into view
	// together: posters fade in left to right, one after the other.
	const rank = new SvelteMap<string, number>();
	const keys = new WeakMap<Element, string>();
	let batch = 0;
	// One observer per row: entries come in the order cards were observed, the page order
	let io: IntersectionObserver | undefined;
	function nearby(node: HTMLElement, key: string) {
		io ??= new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (!e.isIntersecting) continue;
					io!.unobserve(e.target);
					if (!batch) setTimeout(() => (batch = 0), 150);
					rank.set(keys.get(e.target)!, batch++);
				}
			},
			{ root: node.parentElement, rootMargin: '0px 25%' }
		);
		keys.set(node, key);
		io.observe(node);
		return { destroy: () => io?.unobserve(node) };
	}
</script>

{#snippet poster(i: Item)}
	<!-- The shimmer stays under the poster until it has faded in -->
	<div class="shimmer rounded-[10px]">
		{#if rank.has(i.key)}
			<Poster
				src={i.posterUrl}
				title={i.title}
				type={i.type as MediaType}
				delay={rank.get(i.key)! * 70}
				class="w-full rounded-[10px] tile-frame"
			/>
		{:else}
			<div class="aspect-[2/3] w-full"></div>
		{/if}
	</div>
{/snippet}

<ul
	class="-mx-2 -mt-2 flex snap-x scroll-px-2 [scrollbar-width:thin] gap-3.5 overflow-x-auto px-2 pt-2 pb-2"
	aria-label={label}
>
	{#each items as i (i.key)}
		<li class="w-[118px] shrink-0 snap-start sm:w-[132px]" use:nearby={i.key}>
			{#if i.mediaId !== null}
				<a
					href={resolve('/(app)/media/[id]', { id: String(i.mediaId) })}
					class="group flex flex-col gap-2 text-ink no-underline"
				>
					{@render poster(i)}
					<span class={caption}>
						<span class="line-clamp-2 font-semibold group-hover:underline">{i.title}</span>
						{#if i.note}<span class="line-clamp-2 text-muted">{i.note}</span>{/if}
					</span>
				</a>
			{:else}
				<form
					method="post"
					action="{resolve('search')}?/open"
					use:enhance={() => {
						opening.active = true;
						return async ({ update }) => {
							await update();
							opening.active = false;
						};
					}}
				>
					<input type="hidden" name="type" value={i.type} />
					<input type="hidden" name="provider" value={i.provider} />
					<input type="hidden" name="externalId" value={i.externalId} />
					<button class="group flex w-full cursor-pointer flex-col gap-2 text-ink">
						{@render poster(i)}
						<span class={caption}>
							<span class="line-clamp-2 font-semibold group-hover:underline">{i.title}</span>
							{#if i.note}<span class="line-clamp-2 text-muted">{i.note}</span>{/if}
						</span>
					</button>
				</form>
			{/if}
		</li>
	{/each}
</ul>
