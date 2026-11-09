<script lang="ts">
	import { enhance } from '$app/forms';
	import Poster from '#lib/components/Poster.svelte';
	import Progress from '#lib/components/Progress.svelte';
	import TypeTag from '#lib/components/TypeTag.svelte';
	import {
		ENTRY_STATUSES,
		secondaryUnitLabel,
		statusLabel,
		toScale,
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
	const field = 'field w-full';
	const label = 'flex flex-col gap-1.5 text-[13px] text-muted';
	let progress = $derived(entry?.progress ?? 0);
</script>

<svelte:head><title>{m.title} · Vulu</title></svelte:head>

<div class="flex flex-wrap items-start gap-12">
	<article class="flex min-w-0 flex-[999_1_560px] flex-wrap gap-8">
		<Poster src={m.posterUrl} title={m.title} class="w-44 rounded-2xl sm:w-60" />
		<div class="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">
			<div><TypeTag type={m.type} /></div>
			<h1
				class="font-display text-[32px] leading-[1.05] font-extrabold tracking-tight text-balance sm:text-[44px]"
			>
				{m.title}
			</h1>
			<p class="text-muted">
				{[
					m.originalTitle !== m.title ? m.originalTitle : null,
					year,
					m.totalUnits && unit ? `${m.totalUnits} ${unit}` : null,
					m.runtimeMinutes ? `${m.runtimeMinutes} min` : null
				]
					.filter(Boolean)
					.join(' · ')}
			</p>
			{#if data.upcoming}
				<div class="flex items-center gap-3.5 card px-4 py-3.5">
					<svg
						aria-hidden="true"
						class="shrink-0 text-accent"
						width="22"
						height="22"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"
						></path></svg
					>
					<p>
						Prochain épisode : <strong>{data.upcoming.episode}</strong>, {data.upcoming.day}{data
							.upcoming.time
							? ` à ${data.upcoming.time}`
							: ''}
					</p>
				</div>
			{/if}
			{#if m.overview}<p class="max-w-[62ch] whitespace-pre-line">{m.overview}</p>{/if}
			{#if sourceUrl}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external link -->
				<a href={sourceUrl} rel="external" class="text-sm font-semibold">Voir la fiche source ↗</a>
			{/if}
		</div>
	</article>

	<section
		aria-labelledby="library-title"
		class="flex flex-[1_1_340px] flex-col gap-5 card rounded-[20px] p-6"
	>
		<h2 id="library-title" class="h2">Ma bibliothèque</h2>

		{#if !entry}
			<p class="text-muted">Cette œuvre n’est pas encore dans ta bibliothèque.</p>
			<form method="post" action="?/add" use:enhance>
				<button class="btn-accent w-full">Ajouter à ma bibliothèque</button>
			</form>
		{:else}
			<form
				method="post"
				action="?/update"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: false })}
				class="flex flex-col gap-5"
			>
				<input type="hidden" name="entryId" value={entry.id} />
				<fieldset>
					<legend class="mb-2 text-[13px] text-muted">Statut</legend>
					<div class="grid grid-cols-3 gap-1.5">
						{#each ENTRY_STATUSES as s (s)}
							<label
								class="flex min-h-11 cursor-pointer items-center justify-center rounded-[10px] border border-line px-1 text-center text-[13px] font-semibold has-checked:border-accent has-checked:bg-accent has-checked:text-on-accent has-focus-visible:outline-2 has-focus-visible:outline-accent"
							>
								<input
									type="radio"
									name="status"
									value={s}
									checked={entry.status === s}
									class="sr-only"
								/>
								{statusLabel[s]}
							</label>
						{/each}
					</div>
				</fieldset>

				{#if unit}
					<div class="flex flex-col gap-2">
						<label for="progress" class="text-[13px] text-muted"
							>Progression · {unit}{m.totalUnits ? ` sur ${m.totalUnits}` : ''}</label
						>
						<div class="flex items-center gap-2.5">
							<button
								type="button"
								class="btn-ghost w-11 px-0 text-xl"
								aria-label="Retirer un"
								onclick={() => (progress = Math.max(0, progress - 1))}>−</button
							>
							<input
								id="progress"
								name="progress"
								type="number"
								min="0"
								max={m.totalUnits ?? undefined}
								bind:value={progress}
								class="field min-w-0 flex-1 text-center font-display text-2xl font-bold tabular-nums"
							/>
							<button
								type="button"
								class="btn-accent w-11 px-0 text-xl"
								aria-label="Ajouter un"
								onclick={() =>
									(progress = m.totalUnits ? Math.min(m.totalUnits, progress + 1) : progress + 1)}
								>+</button
							>
						</div>
						{#if m.totalUnits}<Progress
								value={progress}
								max={m.totalUnits}
								label="Progression"
							/>{/if}
					</div>
				{:else}
					<input type="hidden" name="progress" value={entry.progress} />
				{/if}

				<div class="grid grid-cols-2 gap-3">
					<label class={label}>
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
					{#if secondary}
						<label class={label}>
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
					<label class={label}>
						Commencé le
						<input name="startedOn" type="date" value={entry.startedOn ?? ''} class={field} />
					</label>
					<label class={label}>
						Terminé le
						<input name="completedOn" type="date" value={entry.completedOn ?? ''} class={field} />
					</label>
				</div>
				<label class={label}>
					Critique
					<textarea name="review" rows="3" class="{field} py-2.5">{entry.review ?? ''}</textarea>
				</label>
				<label class={label}>
					Notes privées
					<textarea name="notes" rows="2" class="{field} py-2.5">{entry.notes ?? ''}</textarea>
				</label>
				<label class="flex min-h-11 items-center gap-2.5 text-sm">
					<input
						name="isFavorite"
						type="checkbox"
						checked={entry.isFavorite}
						class="size-4 accent-accent"
					/>
					Favori
				</label>
				<label class="flex min-h-11 items-center gap-2.5 text-sm">
					<input
						name="isPrivate"
						type="checkbox"
						checked={entry.isPrivate}
						class="size-4 accent-accent"
					/>
					Masquer de mon profil
				</label>
				<div class="flex flex-wrap items-center gap-3">
					<button class="btn-ink">Enregistrer</button>
					{#if form?.error}<p role="alert" class="text-sm text-danger">{form.error}</p>{/if}
					{#if form?.saved}<p role="status" class="text-sm text-success">Enregistré.</p>{/if}
				</div>
			</form>
			<form
				method="post"
				action="?/remove"
				use:enhance={({ cancel }) => {
					if (!confirm('Retirer cette œuvre de ta bibliothèque ?')) cancel();
				}}
			>
				<input type="hidden" name="entryId" value={entry.id} />
				<button class="min-h-11 cursor-pointer text-sm text-danger underline"
					>Retirer de ma bibliothèque</button
				>
			</form>
		{/if}
	</section>
</div>
