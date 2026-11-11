<script lang="ts">
	import { resolve } from '$app/paths';
	import Poster from '#lib/components/Poster.svelte';
	import { typeLabel, type MediaType } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const base = resolve('calendar');
	const monthHref = (month?: string) => `${base}?view=month${month ? `&month=${month}` : ''}`;
	const seg = (active: boolean) =>
		`flex h-10 items-center gap-2 rounded-[10px] px-4 text-sm font-semibold no-underline ${active ? 'bg-ink text-bg' : 'text-muted hover:text-ink'}`;
	const dot: Record<MediaType, string> = {
		movie: 'bg-movie',
		tv: 'bg-tv',
		anime: 'bg-anime',
		manga: 'bg-manga',
		book: 'bg-book'
	};

	// Month view: the selected day defaults to today, else the first day with episodes.
	let picked = $state<string | null>(null);
	const cells = $derived(data.view === 'month' ? data.cells : []);
	const selected = $derived(
		cells.find((c) => c.key === picked) ??
			cells.find((c) => c.key === data.today) ??
			cells.find((c) => c.items.length) ??
			cells.find((c) => c.inMonth)
	);
</script>

<svelte:head><title>Calendrier · Vulu</title></svelte:head>

<div class="flex flex-col gap-7">
	<div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
		<div>
			<h1 class="sr-only">Calendrier</h1>
			<p class="text-muted">Prochains épisodes des séries et anime que tu suis · heure de Paris</p>
		</div>
		<!-- eslint-disable svelte/no-navigation-without-resolve -- built on resolve('calendar') -->
		<nav aria-label="Affichage" class="flex gap-1 card rounded-[14px] p-1">
			<a
				href={base}
				class={seg(data.view === 'list')}
				aria-current={data.view === 'list' ? 'page' : undefined}
			>
				<svg
					aria-hidden="true"
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"></path></svg
				>
				Liste
			</a>
			<a
				href={monthHref()}
				class={seg(data.view === 'month')}
				aria-current={data.view === 'month' ? 'page' : undefined}
			>
				<svg
					aria-hidden="true"
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"
					></path></svg
				>
				Mois
			</a>
		</nav>
	</div>

	{#if data.view === 'list'}
		{#if data.days.length}
			<ol class="flex max-w-3xl flex-col gap-7">
				{#each data.days as day, i (day.key)}
					{@const [weekday, dayNumber, month] = day.label.split(' ')}
					<li class="flex flex-wrap gap-x-6 gap-y-3" aria-labelledby="day-{day.key}">
						<h2 id="day-{day.key}" class="w-24 shrink-0">
							<span class="block eyebrow {i === 0 ? 'text-accent-ink' : ''}">{weekday}</span>
							<span class="block font-display text-[40px] leading-none font-bold">{dayNumber}</span>
							<span class="block text-[13px] font-normal text-muted">{month}</span>
						</h2>
						<ul class="flex min-w-0 flex-[1_1_400px] flex-col gap-2">
							{#each day.items as item (item.key)}
								<li class="flex items-center gap-3.5 card rounded-[14px] py-2.5 pr-4 pl-2.5">
									<Poster src={item.posterUrl} title={item.mediaTitle} class="w-11 rounded-lg" />
									<div class="min-w-0 flex-1">
										<a
											href={resolve('/(app)/media/[id]', { id: String(item.mediaId) })}
											class="text-base font-semibold text-ink no-underline hover:underline"
											>{item.mediaTitle}</a
										>
										<p class="text-[13px] text-muted">
											{item.episode}{item.episodeTitle ? ` · ${item.episodeTitle}` : ''} · {typeLabel[
												item.type
											]}
										</p>
									</div>
									{#if item.time}<span class="font-semibold tabular-nums">{item.time}</span>{/if}
								</li>
							{/each}
						</ul>
					</li>
				{/each}
			</ol>
		{:else}
			<p class="text-muted">
				Aucun épisode prévu sur {data.horizon} jours. Ajoute des séries ou des anime en cours de diffusion
				à ta bibliothèque : leurs prochains épisodes apparaîtront ici.
			</p>
		{/if}
	{:else}
		<div class="flex flex-wrap items-start gap-6">
			<section
				aria-labelledby="month-title"
				class="flex min-w-0 flex-[999_1_640px] flex-col gap-3.5"
			>
				<div class="flex items-center gap-2">
					<h2
						id="month-title"
						class="mr-auto font-display text-[28px] font-bold tracking-tight first-letter:uppercase"
					>
						{data.title}
					</h2>
					{#if !data.isCurrent}<a href={monthHref()} class="btn-ghost bg-transparent text-sm"
							>Aujourd’hui</a
						>{/if}
					<a
						href={monthHref(data.prev)}
						class="btn-ghost w-11 bg-transparent px-0"
						aria-label="Mois précédent"
					>
						<svg
							aria-hidden="true"
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="m15 18-6-6 6-6"></path></svg
						>
					</a>
					<a
						href={monthHref(data.next)}
						class="btn-ghost w-11 bg-transparent px-0"
						aria-label="Mois suivant"
					>
						<svg
							aria-hidden="true"
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg
						>
					</a>
				</div>
				<div class="overflow-x-auto">
					<div class="grid min-w-160 grid-cols-7 gap-1.5">
						{#each ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as w (w)}
							<span aria-hidden="true" class="px-2 text-xs eyebrow">{w}</span>
						{/each}
						{#each data.cells as c (c.key)}
							{#if c.inMonth}
								<button
									type="button"
									onclick={() => (picked = c.key)}
									aria-pressed={selected?.key === c.key}
									aria-label="{c.label}, {c.items.length
										? `${c.items.length} épisode${c.items.length > 1 ? 's' : ''}`
										: 'aucun épisode'}"
									class="flex min-h-28 cursor-pointer flex-col items-start gap-1 rounded-xl bg-surface p-2 text-left {selected?.key ===
									c.key
										? 'border-2 border-accent'
										: 'border border-line hover:border-muted'}"
								>
									<span
										class="inline-flex h-7 items-center text-sm font-semibold {c.key === data.today
											? 'w-7 justify-center rounded-full bg-accent font-bold text-on-accent'
											: c.key < data.today
												? 'px-1 text-muted'
												: 'px-1'}">{c.day}</span
									>
									{#each c.items.slice(0, 2) as e (e.key)}
										<span
											class="flex w-full items-center gap-1.5 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs"
										>
											<span aria-hidden="true" class="size-1.75 shrink-0 rounded-full {dot[e.type]}"
											></span>
											<span class="truncate">{e.mediaTitle} {e.episode}</span>
										</span>
									{/each}
									{#if c.items.length > 2}<span class="pl-1.5 text-xs text-muted"
											>+{c.items.length - 2}</span
										>{/if}
								</button>
							{:else}
								<span
									aria-hidden="true"
									class="min-h-28 rounded-xl border border-line p-2 text-sm opacity-35"
									>{c.day}</span
								>
							{/if}
						{/each}
					</div>
				</div>
			</section>

			{#if selected}
				<aside
					aria-labelledby="day-title"
					aria-live="polite"
					class="flex flex-[1_1_280px] flex-col gap-3.5 card rounded-[20px] p-5"
				>
					<h2 id="day-title" class="font-display text-[26px] font-bold first-letter:uppercase">
						{selected.label}
					</h2>
					{#if selected.items.length}
						<ul class="flex flex-col gap-2.5">
							{#each selected.items as item (item.key)}
								<li class="flex items-center gap-3">
									<Poster src={item.posterUrl} title={item.mediaTitle} class="w-10 rounded-lg" />
									<div class="min-w-0 flex-1">
										<a
											href={resolve('/(app)/media/[id]', { id: String(item.mediaId) })}
											class="font-semibold text-ink no-underline hover:underline"
											>{item.mediaTitle}</a
										>
										<p class="text-[13px] text-muted">
											{item.episode} · {typeLabel[item.type]}
										</p>
									</div>
									{#if item.time}<span class="font-semibold tabular-nums">{item.time}</span>{/if}
								</li>
							{/each}
						</ul>
					{:else}
						<p class="text-muted">Rien de prévu ce jour-là.</p>
					{/if}
				</aside>
			{/if}
		</div>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{/if}
</div>
