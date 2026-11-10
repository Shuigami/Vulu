<script lang="ts">
	import { MEDIA_TYPES, typePlural, type MediaType } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const bg: Record<MediaType, string> = {
		movie: 'bg-movie',
		tv: 'bg-tv',
		anime: 'bg-anime',
		manga: 'bg-manga',
		book: 'bg-book'
	};
	const nf = new Intl.NumberFormat('fr-FR');
	const monthName = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
	const monthLong = new Intl.DateTimeFormat('fr-FR', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	});
	const toDate = (m: string) => new Date(`${m}-01T00:00:00Z`);

	const hours = (min: number) => nf.format(Math.round(min / 60));
	const totalMinutes = $derived(Object.values(data.minutes).reduce((a, b) => a + b, 0));
	const totalCompleted = $derived(Object.values(data.completed).reduce((a, b) => a + b, 0));
	const monthTotals = $derived(
		data.perMonth.map((p) => Object.values(p.counts).reduce((a, b) => a + b, 0))
	);
	const max = $derived(Math.max(1, ...monthTotals));
	const yearCompleted = $derived(monthTotals.reduce((a, b) => a + b, 0));
	const usedTypes = $derived(MEDIA_TYPES.filter((t) => data.perMonth.some((p) => p.counts[t] > 0)));

	const tiles = $derived([
		{
			value: `${hours(totalMinutes)} h`,
			label: 'devant l’écran',
			hint: totalMinutes >= 1440 ? `soit ${nf.format(Math.round(totalMinutes / 1440))} jours` : ''
		},
		{ value: nf.format(totalCompleted), label: 'œuvres terminées', hint: '' },
		{ value: nf.format(data.units.episode), label: 'épisodes vus', hint: '' },
		{
			value: nf.format(data.units.chapter),
			label: 'chapitres lus',
			hint: data.units.pages ? `et ${nf.format(data.units.pages)} pages` : ''
		}
	]);
</script>

<svelte:head><title>Statistiques · Vulu</title></svelte:head>

<div class="flex flex-col gap-9">
	<div>
		<p class="eyebrow">Depuis ton inscription</p>
		<h1 class="mt-1.5 h1">Statistiques</h1>
	</div>

	{#if !totalMinutes && !totalCompleted && !data.units.chapter && !data.units.pages}
		<p class="text-muted">
			Pas encore de chiffres. Avance dans une œuvre ou importe ta bibliothèque, et tes statistiques
			apparaîtront ici.
		</p>
	{:else}
		<ul class="grid grid-cols-2 gap-4 lg:grid-cols-4">
			{#each tiles as t (t.label)}
				<li class="flex flex-col gap-1 card p-5">
					<span class="font-display text-[34px] leading-none font-extrabold tabular-nums"
						>{t.value}</span
					>
					<span class="text-sm text-muted">{t.label}</span>
					{#if t.hint}<span class="text-[13px] text-muted">{t.hint}</span>{/if}
				</li>
			{/each}
		</ul>

		<section class="flex flex-col gap-4 card p-5" aria-labelledby="months-title">
			<div class="flex flex-wrap items-baseline justify-between gap-2">
				<h2 id="months-title" class="h2">Terminées par mois</h2>
				<p class="text-sm text-muted">{nf.format(yearCompleted)} sur 12 mois</p>
			</div>
			{#if usedTypes.length}
				<ul class="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted" aria-hidden="true">
					{#each usedTypes as t (t)}
						<li class="flex items-center gap-1.5">
							<span class="size-2.5 rounded-sm {bg[t]}"></span>{typePlural[t]}
						</li>
					{/each}
				</ul>
			{/if}
			<ol class="flex h-48 items-end gap-1.5 sm:gap-3">
				{#each data.perMonth as p, i (p.month)}
					{@const total = monthTotals[i]}
					{@const name = monthName.format(toDate(p.month)).replace('.', '')}
					{@const detail = usedTypes
						.filter((t) => p.counts[t])
						.map((t) => `${p.counts[t]} ${typePlural[t].toLowerCase()}`)
						.join(', ')}
					<li
						class="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
						title={detail || undefined}
					>
						<span class="sr-only"
							>{monthLong.format(toDate(p.month))} : {total} terminée{total > 1 ? 's' : ''}{detail
								? ` (${detail})`
								: ''}</span
						>
						{#if total}
							<span class="text-xs font-semibold tabular-nums" aria-hidden="true">{total}</span>
						{/if}
						<span
							class="flex w-full max-w-10 flex-col-reverse gap-px overflow-hidden rounded-md"
							style:height="{(total / max) * 100}%"
							aria-hidden="true"
						>
							{#each usedTypes as t (t)}
								{#if p.counts[t]}
									<span class="w-full {bg[t]}" style:flex-grow={p.counts[t]}></span>
								{/if}
							{/each}
						</span>
						<span class="text-xs text-muted" aria-hidden="true"
							><span class="sm:hidden">{name[0].toUpperCase()}</span><span class="hidden sm:inline"
								>{name}</span
							></span
						>
					</li>
				{/each}
			</ol>
		</section>

		<section class="flex flex-col gap-3" aria-labelledby="types-title">
			<h2 id="types-title" class="h2">Par type</h2>
			<table class="w-full text-sm">
				<thead class="text-left text-muted">
					<tr class="border-b border-line">
						<th class="py-2 font-medium">Type</th>
						<th class="py-2 text-right font-medium">Terminées</th>
						<th class="py-2 text-right font-medium">Temps</th>
					</tr>
				</thead>
				<tbody>
					{#each MEDIA_TYPES as t (t)}
						<tr class="border-b border-line">
							<td class="py-2.5">
								<span class="mr-2 inline-block size-2.5 rounded-sm {bg[t]}"></span>{typePlural[t]}
							</td>
							<td class="py-2.5 text-right tabular-nums">{nf.format(data.completed[t])}</td>
							<td class="py-2.5 text-right text-muted tabular-nums"
								>{data.minutes[t] ? `${hours(data.minutes[t])} h` : '—'}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/if}
</div>
