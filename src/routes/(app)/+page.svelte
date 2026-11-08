<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Poster from '#lib/components/Poster.svelte';
	import Progress from '#lib/components/Progress.svelte';
	import TypeTag from '#lib/components/TypeTag.svelte';
	import { toScale, unitLabel } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let pending = $state<number | null>(null);
	const singular = { épisodes: 'épisode', chapitres: 'chapitre', pages: 'page' } as Record<
		string,
		string
	>;
	const scale = $derived(data.user.ratingScale);
</script>

<svelte:head><title>En cours · Vulu</title></svelte:head>

<div class="flex flex-col gap-14">
	<section class="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
		<div>
			<p class="eyebrow first-letter:uppercase">{data.today}</p>
			<h1 class="mt-1.5 h1">En cours</h1>
		</div>
		<div class="flex flex-wrap gap-3">
			<div class="min-w-32 card px-4.5 py-3">
				<p class="font-display text-[28px] font-bold">{data.entries.length}</p>
				<p class="text-[13px] text-muted">œuvres en cours</p>
			</div>
			<div class="min-w-32 card px-4.5 py-3">
				<p class="font-display text-[28px] font-bold text-accent-ink">{data.week.length}</p>
				<p class="text-[13px] text-muted">épisodes cette semaine</p>
			</div>
		</div>
	</section>

	<section aria-labelledby="resume" class="flex flex-col gap-5">
		<h2 id="resume" class="h2">Reprendre</h2>
		{#if data.entries.length}
			<ul class="grid [grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-4">
				{#each data.entries as e (e.id)}
					{@const unit = unitLabel[e.type]}
					{@const href = resolve('/(app)/media/[id]', { id: String(e.mediaId) })}
					<li class="flex gap-4 card p-3.5">
						<a {href} tabindex="-1" aria-hidden="true">
							<Poster src={e.posterUrl} title={e.title} class="w-21 rounded-[10px]" />
						</a>
						<div class="flex min-w-0 flex-1 flex-col gap-1.5">
							<div><TypeTag type={e.type} /></div>
							<a
								{href}
								class="text-[17px] leading-tight font-semibold text-ink no-underline hover:underline"
								>{e.title}</a
							>
							<p class="text-[13px] text-muted">
								{e.year ?? ''}{e.score !== null ? ` · ★ ${toScale(e.score, scale)}/${scale}` : ''}
							</p>
							{#if unit}
								<div class="mt-auto flex items-center gap-3">
									<div class="flex flex-1 flex-col gap-1.5">
										{#if e.totalUnits}
											<Progress
												value={e.progress}
												max={e.totalUnits}
												label="Progression de {e.title}"
											/>
										{/if}
										<p class="text-[13px] text-muted tabular-nums">
											<strong class="font-semibold text-ink">{e.progress}</strong>{e.totalUnits
												? ` / ${e.totalUnits}`
												: ''}
											{unit}
										</p>
									</div>
									<form
										method="post"
										action="?/increment"
										use:enhance={() => {
											pending = e.id;
											return async ({ update }) => {
												await update();
												pending = null;
											};
										}}
									>
										<input type="hidden" name="entryId" value={e.id} />
										<button
											disabled={pending === e.id}
											aria-label="+1 {singular[unit]} pour {e.title}"
											class="btn-accent min-w-14">+1</button
										>
									</form>
								</div>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-muted">
				Rien en cours. Cherche une œuvre, ajoute-la, puis passe-la « En cours » ou avance sa
				progression.
			</p>
		{/if}
	</section>

	<section aria-labelledby="week" class="flex flex-col gap-5">
		<div class="flex items-baseline justify-between gap-4">
			<h2 id="week" class="h2">Cette semaine</h2>
			<a href={resolve('calendar')} class="text-sm font-semibold">Tout le calendrier →</a>
		</div>
		{#if data.week.length}
			<ul class="grid [grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-3">
				{#each data.week as w (w.key)}
					<li class="flex items-center gap-3.5 rounded-2xl border border-line px-3.5 py-3">
						<div class="w-13 shrink-0 border-r border-line pr-3 text-center">
							<p class="text-xs tracking-wider text-muted uppercase">{w.weekday}</p>
							<p class="font-display text-2xl leading-tight font-bold">{w.dayNumber}</p>
						</div>
						<div class="min-w-0">
							<a
								href={resolve('/(app)/media/[id]', { id: String(w.mediaId) })}
								class="font-semibold text-ink no-underline hover:underline">{w.mediaTitle}</a
							>
							<p class="text-[13px] text-muted">{w.episode}{w.time ? ` · ${w.time}` : ''}</p>
						</div>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-muted">Aucun épisode prévu dans les 7 prochains jours.</p>
		{/if}
	</section>
</div>
