<script lang="ts">
	import { enhance } from '$app/forms';
	import ListCard from '#lib/components/ListCard.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Mes listes · Vulu</title></svelte:head>

<div class="flex flex-col gap-9">
	<h1 class="sr-only">Mes listes</h1>

	<form
		method="post"
		action="?/create"
		use:enhance
		class="flex max-w-xl flex-col gap-3 card p-5"
		aria-labelledby="new-list-title"
	>
		<h2 id="new-list-title" class="h2">Nouvelle liste</h2>
		<input
			name="name"
			required
			maxlength="80"
			placeholder="Ex. : Mes films d’horreur préférés"
			aria-label="Nom de la liste"
			class="field"
		/>
		<textarea
			name="description"
			maxlength="500"
			rows="2"
			placeholder="Description (facultative)"
			aria-label="Description"
			class="field py-2.5"></textarea>
		<label class="flex min-h-11 items-center gap-2.5 text-sm">
			<input type="checkbox" name="public" class="size-4 accent-accent" />
			Visible sur mon profil
		</label>
		<div class="flex items-center gap-3">
			<button class="btn-ink">Créer</button>
			{#if form?.error}<p role="alert" class="text-sm text-danger">{form.error}</p>{/if}
		</div>
	</form>

	{#if data.lists.length}
		<ul class="grid [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))] gap-x-5 gap-y-7">
			{#each data.lists as list (list.id)}
				<li><ListCard {list} /></li>
			{/each}
		</ul>
	{:else}
		<p class="text-muted">
			Pas encore de liste. Crée-en une ici, puis ajoute des œuvres depuis leur fiche.
		</p>
	{/if}
</div>
