<script lang="ts">
	import { enhance } from '$app/forms';
	import Poster from '#lib/components/Poster.svelte';
	import {
		ENTRY_STATUSES,
		secondaryUnitLabel,
		statusLabel,
		toScale,
		typeLabel,
		unitLabel
	} from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const m = $derived(data.media);
	const entry = $derived(data.entry);
	const scale = $derived(data.user.ratingScale);
	const unit = $derived(unitLabel[m.type]);
	const secondary = $derived(secondaryUnitLabel[m.type]);
	const year = $derived(m.startDate?.slice(0, 4));
	const sourceUrl = $derived.by(() => {
		const id = data.externalIds[0];
		if (!id) return null;
		if (id.provider === 'tmdb') return `https://www.themoviedb.org/${m.type}/${id.externalId}`;
		if (id.provider === 'anilist') return `https://anilist.co/${m.type}/${id.externalId}`;
		if (id.provider === 'openlibrary') return `https://openlibrary.org/works/${id.externalId}`;
		return null;
	});
	const field = 'rounded border border-gray-300 px-2 py-1.5';
</script>

<svelte:head><title>{m.title} · Vulu</title></svelte:head>

<article class="flex flex-col gap-6 sm:flex-row">
	<Poster src={m.posterUrl} title={m.title} size="lg" />
	<div class="min-w-0 flex-1">
		<h1 class="text-2xl font-semibold">{m.title}</h1>
		{#if m.originalTitle}<p class="text-gray-600">{m.originalTitle}</p>{/if}
		<p class="mt-1 text-sm text-gray-500">
			{typeLabel[m.type]}{year ? ` · ${year}` : ''}{m.totalUnits && unit
				? ` · ${m.totalUnits} ${unit}`
				: ''}{m.runtimeMinutes ? ` · ${m.runtimeMinutes} min` : ''}
		</p>
		{#if m.overview}<p class="mt-4 whitespace-pre-line">{m.overview}</p>{/if}
		{#if sourceUrl}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external link -->
			<a href={sourceUrl} rel="external" class="mt-2 inline-block text-sm text-gray-500 underline"
				>Voir la fiche source</a
			>
		{/if}
	</div>
</article>

<section class="mt-8 rounded border border-gray-200 p-4" aria-labelledby="library-title">
	<h2 id="library-title" class="font-medium">Ma bibliothèque</h2>

	{#if !entry}
		<form method="post" action="?/add" use:enhance class="mt-3">
			<button class="rounded bg-gray-900 px-3 py-2 text-white">Ajouter à ma bibliothèque</button>
		</form>
	{:else}
		<form
			method="post"
			action="?/update"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="mt-3 grid gap-3 sm:grid-cols-2"
		>
			<input type="hidden" name="entryId" value={entry.id} />
			<label class="flex flex-col gap-1 text-sm">
				Statut
				<select name="status" class={field} value={entry.status}>
					{#each ENTRY_STATUSES as s (s)}<option value={s}>{statusLabel[s]}</option>{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1 text-sm">
				Note (sur {scale})
				<input
					name="score"
					type="number"
					min="0"
					max={scale}
					step={scale === 100 ? 1 : 0.5}
					value={entry.score === null ? '' : toScale(entry.score, scale)}
					class={field}
				/>
			</label>
			{#if unit}
				<label class="flex flex-col gap-1 text-sm">
					Progression ({unit}{m.totalUnits ? ` sur ${m.totalUnits}` : ''})
					<input
						name="progress"
						type="number"
						min="0"
						max={m.totalUnits ?? undefined}
						value={entry.progress}
						class={field}
					/>
				</label>
			{:else}
				<input type="hidden" name="progress" value={entry.progress} />
			{/if}
			{#if secondary}
				<label class="flex flex-col gap-1 text-sm">
					{secondary[0].toUpperCase() + secondary.slice(1)}{m.totalUnitsSecondary
						? ` (sur ${m.totalUnitsSecondary})`
						: ''}
					<input
						name="progressSecondary"
						type="number"
						min="0"
						value={entry.progressSecondary}
						class={field}
					/>
				</label>
			{:else}
				<input type="hidden" name="progressSecondary" value={entry.progressSecondary} />
			{/if}
			<label class="flex flex-col gap-1 text-sm">
				Commencé le
				<input name="startedOn" type="date" value={entry.startedOn ?? ''} class={field} />
			</label>
			<label class="flex flex-col gap-1 text-sm">
				Terminé le
				<input name="completedOn" type="date" value={entry.completedOn ?? ''} class={field} />
			</label>
			<label class="flex flex-col gap-1 text-sm sm:col-span-2">
				Critique
				<textarea name="review" rows="3" class={field}>{entry.review ?? ''}</textarea>
			</label>
			<label class="flex flex-col gap-1 text-sm sm:col-span-2">
				Notes privées
				<textarea name="notes" rows="2" class={field}>{entry.notes ?? ''}</textarea>
			</label>
			<label class="flex items-center gap-2 text-sm">
				<input name="isFavorite" type="checkbox" checked={entry.isFavorite} /> Favori
			</label>
			<div class="flex items-center gap-3 sm:col-span-2">
				<button class="rounded bg-gray-900 px-3 py-2 text-white">Enregistrer</button>
				{#if form?.error}<p role="alert" class="text-sm text-red-600">{form.error}</p>{/if}
				{#if form?.saved}<p role="status" class="text-sm text-green-700">Enregistré.</p>{/if}
			</div>
		</form>
		<form
			method="post"
			action="?/remove"
			use:enhance={({ cancel }) => {
				if (!confirm('Retirer cette œuvre de ta bibliothèque ?')) cancel();
			}}
			class="mt-4"
		>
			<input type="hidden" name="entryId" value={entry.id} />
			<button class="text-sm text-red-700 underline">Retirer de ma bibliothèque</button>
		</form>
	{/if}
</section>
