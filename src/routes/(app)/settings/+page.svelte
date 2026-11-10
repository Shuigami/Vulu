<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { MEDIA_TYPES, RATING_SCALES, typePlural, type MediaType } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let exportType = $state<MediaType | null>(null);
	const options = [
		{
			value: 'public',
			label: 'Public',
			help: 'Les membres voient ton profil, tes notes et ton activité, et peuvent s’abonner.'
		},
		{ value: 'private', label: 'Privé', help: 'Personne d’autre ne voit ta bibliothèque.' }
	];
	const scaleHelp: Record<number, string> = {
		5: 'Comme des étoiles, demi-points possibles.',
		10: 'Demi-points possibles.',
		100: 'Comme sur AniList.'
	};
</script>

<svelte:head><title>Réglages · Vulu</title></svelte:head>

<div class="flex max-w-xl flex-col gap-7">
	<h1 class="h1">Réglages</h1>
	<form
		method="post"
		use:enhance={() =>
			({ update }) =>
				update({ reset: false })}
		class="flex flex-col gap-6 card p-5"
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
			<p class="text-[13px] text-muted">
				Une œuvre précise peut aussi être masquée depuis sa fiche (« Masquer de mon profil »).
			</p>
		</fieldset>
		<fieldset class="flex flex-col gap-2">
			<legend class="mb-2 h2">Échelle de notation</legend>
			{#each RATING_SCALES as s (s)}
				<label class="flex min-h-11 items-start gap-2.5 text-sm">
					<input
						type="radio"
						name="ratingScale"
						value={s}
						checked={data.ratingScale === s}
						class="mt-0.5 size-4 accent-accent"
					/>
					<span><strong>Sur {s}</strong><br /><span class="text-muted">{scaleHelp[s]}</span></span>
				</label>
			{/each}
			<p class="text-[13px] text-muted">Tes notes existantes sont converties, rien n’est perdu.</p>
		</fieldset>
		<div class="flex items-center gap-3">
			<button class="btn-ink">Enregistrer</button>
			{#if form?.error}<p role="alert" class="text-sm text-danger">{form.error}</p>{/if}
			{#if form?.saved}<p role="status" class="text-sm text-success">Enregistré.</p>{/if}
		</div>
	</form>

	<section class="flex flex-col gap-3 card p-5" aria-labelledby="export-title">
		<h2 id="export-title" class="h2">Exporter mes données</h2>
		<p class="text-sm text-muted">
			Ta bibliothèque, avec les identifiants TMDB, AniList, MAL et Open Library pour la réimporter
			ailleurs. Le JSON contient aussi ton historique.
		</p>
		<div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Types à exporter">
			{#each [null, ...MEDIA_TYPES] as t (t)}
				<button
					type="button"
					role="radio"
					aria-checked={exportType === t}
					class={exportType === t ? 'chip-on' : 'chip'}
					onclick={() => (exportType = t)}>{t ? typePlural[t] : 'Tout'}</button
				>
			{/each}
		</div>
		<div class="flex flex-wrap gap-3">
			{#each ['json', 'csv'] as format (format)}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- query on a resolved path -->
				<a
					class="btn-ink no-underline"
					href="{resolve('/(app)/settings/export.[format]', { format })}{exportType
						? `?type=${exportType}`
						: ''}"
					download>{format.toUpperCase()}</a
				>
			{/each}
		</div>
	</section>
</div>
