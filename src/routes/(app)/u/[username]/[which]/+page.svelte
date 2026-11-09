<script lang="ts">
	import { resolve } from '$app/paths';
	import Avatar from '#lib/components/Avatar.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const name = $derived(data.user.displayName || data.user.username);
	const title = $derived(data.which === 'followers' ? 'Abonnés' : 'Abonnements');
</script>

<svelte:head><title>{title} de {name} · Vulu</title></svelte:head>

<div class="flex flex-col gap-7">
	<div>
		<a
			href={resolve('/(app)/u/[username]', { username: data.user.username })}
			class="eyebrow no-underline hover:text-ink">{name}</a
		>
		<h1 class="mt-1.5 h1">{title}</h1>
	</div>
	{#if data.users.length}
		<ul class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-3">
			{#each data.users as u (u.id)}
				<li>
					<a
						href={resolve('/(app)/u/[username]', { username: u.username })}
						class="flex items-center gap-3 card p-3 text-ink no-underline hover:border-muted"
					>
						<Avatar src={u.avatarUrl} name={u.displayName || u.username} />
						<span class="min-w-0">
							<span class="block truncate font-semibold">{u.displayName || u.username}</span>
							<span class="block truncate text-[13px] text-muted">@{u.username}</span>
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-muted">Personne pour l’instant.</p>
	{/if}
</div>
