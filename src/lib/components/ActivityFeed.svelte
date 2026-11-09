<script lang="ts">
	import { resolve } from '$app/paths';
	import Avatar from '#lib/components/Avatar.svelte';
	import Poster from '#lib/components/Poster.svelte';
	import { toScale } from '#lib/labels.ts';

	type Item = {
		key: string;
		username: string;
		name: string;
		avatarUrl: string | null;
		mediaId: number;
		title: string;
		posterUrl: string | null;
		verb: string;
		score: number | null;
		when: string;
	};
	let {
		items,
		scale,
		showUser = true
	}: { items: Item[]; scale: number; showUser?: boolean } = $props();
</script>

<ul class="flex flex-col divide-y divide-line">
	{#each items as i (i.key)}
		{@const media = resolve('/(app)/media/[id]', { id: String(i.mediaId) })}
		{@const profile = resolve('/(app)/u/[username]', { username: i.username })}
		<li class="flex items-center gap-3.5 py-3">
			{#if showUser}
				<a href={profile} tabindex="-1" aria-hidden="true"
					><Avatar src={i.avatarUrl} name={i.name} /></a
				>
			{/if}
			<p class="min-w-0 flex-1 text-sm leading-snug">
				{#if showUser}
					<a href={profile} class="font-semibold text-ink no-underline hover:underline">{i.name}</a>
				{/if}
				<span class="text-muted">{i.verb}</span>
				<a href={media} class="font-semibold text-ink no-underline hover:underline">{i.title}</a>
				{#if i.score !== null}<span class="whitespace-nowrap text-accent-ink"
						>★ {toScale(i.score, scale)}/{scale}</span
					>{/if}
				<span class="block text-[13px] text-muted">{i.when}</span>
			</p>
			<a href={media} tabindex="-1" aria-hidden="true">
				<Poster src={i.posterUrl} title={i.title} class="w-10 rounded-md" />
			</a>
		</li>
	{/each}
</ul>
