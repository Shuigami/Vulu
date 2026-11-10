<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import ActivityFeed from '#lib/components/ActivityFeed.svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import ListCard from '#lib/components/ListCard.svelte';
	import Poster from '#lib/components/Poster.svelte';
	import { toScale, typePlural } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const p = $derived(data.profile);
	const name = $derived(p.user.displayName || p.user.username);
	const scale = $derived(data.user.ratingScale);
	const list = (which: 'followers' | 'following') =>
		resolve('/(app)/u/[username]/[which]', { username: p.user.username, which });
</script>

<svelte:head><title>{name} · Vulu</title></svelte:head>

<div class="flex flex-col gap-12">
	<section class="flex flex-wrap items-center gap-x-6 gap-y-4">
		<Avatar src={p.user.avatarUrl} {name} class="size-20 text-3xl" />
		<div class="min-w-0 flex-1">
			<h1 class="font-display text-[36px] leading-none font-extrabold tracking-tight">{name}</h1>
			<p class="mt-1.5 text-sm text-muted">
				@{p.user.username}{p.user.profileVisibility === 'private' ? ' · profil privé' : ''}
			</p>
			<p class="mt-2 flex gap-4 text-sm">
				<a href={list('followers')} class="text-muted no-underline hover:text-ink"
					><strong class="text-ink">{p.followers}</strong>
					{p.followers > 1 ? 'abonnés' : 'abonné'}</a
				>
				<a href={list('following')} class="text-muted no-underline hover:text-ink"
					><strong class="text-ink">{p.following}</strong>
					{p.following > 1 ? 'abonnements' : 'abonnement'}</a
				>
			</p>
		</div>
		{#if p.isSelf}
			<a href={resolve('settings')} class="btn-ghost">Réglages</a>
		{:else}
			<form method="post" action={p.isFollowing ? '?/unfollow' : '?/follow'} use:enhance>
				{#if p.isFollowing}
					<button class="btn-ghost">Abonné ✓</button>
				{:else}
					<button class="btn-accent">Suivre</button>
				{/if}
			</form>
		{/if}
	</section>

	{#if p.completed.length}
		<section aria-label="Œuvres terminées" class="flex flex-wrap gap-3">
			{#each p.completed as c (c.type)}
				<div class="min-w-28 card px-4.5 py-3">
					<p class="font-display text-[28px] font-bold">{c.count}</p>
					<p class="text-[13px] text-muted">{typePlural[c.type]} terminés</p>
				</div>
			{/each}
		</section>
	{/if}

	{#if p.favorites.length}
		<section aria-labelledby="favorites" class="flex flex-col gap-5">
			<h2 id="favorites" class="h2">Favoris</h2>
			<ul class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-4">
				{#each p.favorites as f (f.mediaId)}
					<li>
						<a
							href={resolve('/(app)/media/[id]', { id: String(f.mediaId) })}
							class="group flex flex-col gap-1.5 text-sm text-ink no-underline hover:underline"
						>
							<Poster src={f.posterUrl} title={f.title} class="w-full rounded-[10px] tile-frame" />
							<span class="leading-tight font-semibold">{f.title}</span>
							{#if f.score !== null}<span class="text-[13px] text-muted"
									>★ {toScale(f.score, scale)}/{scale}</span
								>{/if}
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if data.lists.length}
		<section aria-labelledby="lists" class="flex flex-col gap-5">
			<h2 id="lists" class="h2">Listes</h2>
			<ul class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-5 gap-y-6">
				{#each data.lists as list (list.id)}
					<li><ListCard {list} /></li>
				{/each}
			</ul>
		</section>
	{/if}

	<section aria-labelledby="recent" class="flex flex-col gap-3">
		<h2 id="recent" class="h2">Activité récente</h2>
		{#if data.activity.length}
			<ActivityFeed items={data.activity} {scale} showUser={false} />
		{:else}
			<p class="text-muted">Rien pour l’instant.</p>
		{/if}
	</section>
</div>
