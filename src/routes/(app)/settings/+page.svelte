<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const options = [
		{
			value: 'public',
			label: 'Public',
			help: 'Les membres voient ton profil, tes notes et ton activité, et peuvent s’abonner.'
		},
		{ value: 'private', label: 'Privé', help: 'Personne d’autre ne voit ta bibliothèque.' }
	];
</script>

<svelte:head><title>Réglages · Vulu</title></svelte:head>

<div class="flex max-w-xl flex-col gap-7">
	<h1 class="h1">Réglages</h1>
	<form
		method="post"
		use:enhance={() =>
			({ update }) =>
				update({ reset: false })}
		class="flex flex-col gap-4 card p-5"
	>
		<fieldset class="flex flex-col gap-2">
			<legend class="mb-2 h2">Visibilité du profil</legend>
			{#each options as o (o.value)}
				<label class="flex min-h-11 items-start gap-2.5 text-sm">
					<input
						type="radio"
						name="profileVisibility"
						value={o.value}
						checked={(data.profileVisibility === 'private' ? 'private' : 'public') === o.value}
						class="mt-0.5 size-4 accent-accent"
					/>
					<span><strong>{o.label}</strong><br /><span class="text-muted">{o.help}</span></span>
				</label>
			{/each}
		</fieldset>
		<p class="text-[13px] text-muted">
			Une œuvre précise peut aussi être masquée depuis sa fiche (« Masquer de mon profil »).
		</p>
		<div class="flex items-center gap-3">
			<button class="btn-ink">Enregistrer</button>
			{#if form?.error}<p role="alert" class="text-sm text-danger">{form.error}</p>{/if}
			{#if form?.saved}<p role="status" class="text-sm text-success">Enregistré.</p>{/if}
		</div>
	</form>
</div>
