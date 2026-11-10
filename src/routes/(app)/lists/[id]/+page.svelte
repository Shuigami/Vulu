<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Poster from '#lib/components/Poster.svelte';
	import { typeLabel } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const list = $derived(data.list);
	let editing = $state(false);
	let confirmDelete = $state(false);
</script>

<svelte:head><title>{list.name} · Vulu</title></svelte:head>

<div class="flex flex-col gap-9">
	<div class="flex flex-col gap-3">
		<p class="eyebrow">
			{#if list.isOwner}
				<a href={resolve('lists')} class="text-muted no-underline hover:text-ink">Mes listes</a>
			{:else}
				Liste de
				<a
					href={resolve('/(app)/u/[username]', { username: list.username })}
					class="text-muted hover:text-ink">{list.displayName || list.username}</a
				>
			{/if}
		</p>
		<h1 class="h1">{list.name}</h1>
		{#if list.description}<p class="max-w-2xl text-muted">{list.description}</p>{/if}
		<p class="text-sm text-muted">
			{list.items.length}
			{list.items.length > 1 ? 'œuvres' : 'œuvre'}{list.isOwner
				? list.visibility === 'public'
					? ' · visible sur ton profil'
					: ' · privée'
				: ''}
		</p>
		{#if list.isOwner && !editing}
			<div class="flex flex-wrap gap-2">
				<button type="button" class="btn-ghost" onclick={() => (editing = true)}>Modifier</button>
				<!-- Confirmed in the page: native confirm() is blocked in some browsers and webviews -->
				{#if confirmDelete}
					<form method="post" action="?/delete" use:enhance class="flex items-center gap-2">
						<span class="text-sm"
							>Supprimer la liste ? Les œuvres restent dans ta bibliothèque.</span
						>
						<button class="btn bg-danger text-sm text-bg">Supprimer</button>
						<button type="button" class="btn-ghost text-sm" onclick={() => (confirmDelete = false)}
							>Annuler</button
						>
					</form>
				{:else}
					<button type="button" class="btn-ghost text-danger" onclick={() => (confirmDelete = true)}
						>Supprimer</button
					>
				{/if}
			</div>
		{/if}
	</div>

	{#if list.isOwner && editing}
		<form
			method="post"
			action="?/update"
			use:enhance={() =>
				async ({ result, update }) => {
					await update({ reset: false });
					if (result.type === 'success') editing = false;
				}}
			class="flex max-w-xl flex-col gap-3 card p-5"
		>
			<input
				name="name"
				required
				maxlength="80"
				value={list.name}
				aria-label="Nom de la liste"
				class="field"
			/>
			<textarea
				name="description"
				maxlength="500"
				rows="2"
				placeholder="Description (facultative)"
				aria-label="Description"
				class="field py-2.5">{list.description ?? ''}</textarea
			>
			<label class="flex min-h-11 items-center gap-2.5 text-sm">
				<input
					type="checkbox"
					name="public"
					checked={list.visibility === 'public'}
					class="size-4 accent-accent"
				/>
				Visible sur mon profil
			</label>
			<div class="flex items-center gap-3">
				<button class="btn-ink">Enregistrer</button>
				<button type="button" class="btn-ghost" onclick={() => (editing = false)}>Annuler</button>
				{#if form?.error}<p role="alert" class="text-sm text-danger">{form.error}</p>{/if}
			</div>
		</form>
	{/if}

	{#if list.items.length}
		<ol class="grid [grid-template-columns:repeat(auto-fill,minmax(140px,1fr))] gap-x-5 gap-y-7">
			{#each list.items as item (item.mediaId)}
				<li class="flex flex-col gap-2">
					<a
						href={resolve('/(app)/media/[id]', { id: String(item.mediaId) })}
						class="group flex flex-col gap-2.5 text-ink no-underline"
					>
						<div class="overflow-hidden rounded-xl tile-frame">
							<Poster src={item.posterUrl} title={item.title} class="w-full" />
						</div>
						<div>
							<p class="leading-snug font-semibold group-hover:underline">{item.title}</p>
							<p class="mt-0.5 text-[13px] text-muted">
								{typeLabel[item.type]}{item.year ? ` · ${item.year}` : ''}
							</p>
						</div>
					</a>
					{#if list.isOwner}
						<form method="post" action="?/remove" use:enhance>
							<input type="hidden" name="mediaId" value={item.mediaId} />
							<button
								class="cursor-pointer text-[13px] text-muted underline hover:text-danger"
								aria-label="Retirer {item.title} de la liste">Retirer</button
							>
						</form>
					{/if}
				</li>
			{/each}
		</ol>
	{:else}
		<p class="text-muted">
			{list.isOwner
				? 'Liste vide. Ouvre la fiche d’une œuvre et choisis « Ajouter à une liste ».'
				: 'Cette liste est vide.'}
		</p>
	{/if}
</div>
