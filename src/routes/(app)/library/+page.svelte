<script lang="ts">
	import { resolve } from '$app/paths';
	import Poster from '#lib/components/Poster.svelte';
	import {
		ENTRY_STATUSES,
		MEDIA_TYPES,
		statusLabel,
		toScale,
		typeLabel,
		typePlural,
		unitLabel
	} from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const href = (change: { type?: string | null; status?: string | null }) => {
		const type = 'type' in change ? change.type : data.type;
		const status = 'status' in change ? change.status : data.status;
		const query = [type && `type=${type}`, status && `status=${status}`].filter(Boolean).join('&');
		return `${resolve('library')}${query ? `?${query}` : ''}`;
	};
	const tab = (active: boolean) =>
		`-mb-px border-b-2 px-3.5 py-2.5 text-sm no-underline ${active ? 'border-accent font-semibold text-ink' : 'border-transparent text-muted hover:text-ink'}`;
	const scale = $derived(data.user.ratingScale);
</script>

<svelte:head><title>Bibliothèque · Vulu</title></svelte:head>

<div class="flex flex-col gap-7">
	<h1 class="h1">
		Bibliothèque <span class="text-[32px] font-medium text-muted">{data.entries.length}</span>
	</h1>

	<!-- eslint-disable svelte/no-navigation-without-resolve -- href() builds on resolve() -->
	<div class="flex flex-col gap-3">
		<nav class="flex flex-wrap gap-2" aria-label="Filtrer par type">
			<a
				href={href({ type: null })}
				class={!data.type ? 'chip-on' : 'chip'}
				aria-current={!data.type ? 'page' : undefined}>Tous</a
			>
			{#each MEDIA_TYPES as t (t)}
				<a
					href={href({ type: t })}
					class={data.type === t ? 'chip-on' : 'chip'}
					aria-current={data.type === t ? 'page' : undefined}>{typePlural[t]}</a
				>
			{/each}
		</nav>
		<nav class="flex flex-wrap gap-1 border-b border-line" aria-label="Filtrer par statut">
			<a
				href={href({ status: null })}
				class={tab(!data.status)}
				aria-current={!data.status ? 'page' : undefined}>Tous les statuts</a
			>
			{#each ENTRY_STATUSES as s (s)}
				<a
					href={href({ status: s })}
					class={tab(data.status === s)}
					aria-current={data.status === s ? 'page' : undefined}>{statusLabel[s]}</a
				>
			{/each}
		</nav>
	</div>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->

	{#if data.entries.length}
		<ul class="grid [grid-template-columns:repeat(auto-fill,minmax(140px,1fr))] gap-x-5 gap-y-7">
			{#each data.entries as e (e.id)}
				{@const unit = unitLabel[e.type]}
				<li>
					<a
						href={resolve('/(app)/media/[id]', { id: String(e.mediaId) })}
						class="group flex flex-col gap-2.5 text-ink no-underline"
					>
						<div class="relative overflow-hidden rounded-xl">
							<Poster
								src={e.posterUrl}
								title={e.title}
								class="w-full transition group-hover:opacity-85"
							/>
							<span
								class="absolute top-2.5 left-2.5 rounded-md bg-black/75 px-2 py-0.5 text-xs font-semibold text-white"
								>{statusLabel[e.status]}</span
							>
							{#if unit && e.totalUnits && e.progress > 0 && e.status !== 'completed'}
								<span class="absolute inset-x-0 bottom-0 h-1 bg-black/50">
									<span
										class="block h-full bg-accent"
										style:width="{Math.min(100, Math.round((e.progress / e.totalUnits) * 100))}%"
									></span>
								</span>
							{/if}
						</div>
						<div>
							<p class="leading-snug font-semibold group-hover:underline">{e.title}</p>
							<p class="mt-0.5 text-[13px] text-muted">
								{typeLabel[e.type]}{unit && e.progress
									? ` · ${e.progress}${e.totalUnits ? `/${e.totalUnits}` : ''} ${unit}`
									: e.year
										? ` · ${e.year}`
										: ''}{e.score !== null ? ` · ★ ${toScale(e.score, scale)}` : ''}
							</p>
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-muted">
			Rien ici pour l’instant. Utilise la recherche, en haut, pour ajouter une œuvre.
		</p>
	{/if}
</div>
