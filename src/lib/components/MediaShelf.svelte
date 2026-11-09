<script lang="ts">
	import { resolve } from '$app/paths';
	import Poster from '#lib/components/Poster.svelte';

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
	const caption = 'flex flex-col gap-0.5 text-left text-[13px] leading-tight';
</script>

<ul
	class="-mx-1 flex snap-x [scrollbar-width:thin] gap-3.5 overflow-x-auto px-1 pb-2"
	aria-label={label}
>
	{#each items as i (i.key)}
		<li class="w-[118px] shrink-0 snap-start sm:w-[132px]">
			{#if i.mediaId !== null}
				<a
					href={resolve('/(app)/media/[id]', { id: String(i.mediaId) })}
					class="group flex flex-col gap-2 text-ink no-underline"
				>
					<Poster
						src={i.posterUrl}
						title={i.title}
						class="w-full rounded-[10px] transition group-hover:opacity-85"
					/>
					<span class={caption}>
						<span class="line-clamp-2 font-semibold group-hover:underline">{i.title}</span>
						{#if i.note}<span class="line-clamp-2 text-muted">{i.note}</span>{/if}
					</span>
				</a>
			{:else}
				<form method="post" action="{resolve('search')}?/open">
					<input type="hidden" name="type" value={i.type} />
					<input type="hidden" name="provider" value={i.provider} />
					<input type="hidden" name="externalId" value={i.externalId} />
					<button class="group flex w-full cursor-pointer flex-col gap-2 text-ink">
						<Poster
							src={i.posterUrl}
							title={i.title}
							class="w-full rounded-[10px] transition group-hover:opacity-85"
						/>
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
