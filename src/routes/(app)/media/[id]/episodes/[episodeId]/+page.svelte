<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Poster from '#lib/components/Poster.svelte';
	import StarRating from '#lib/components/StarRating.svelte';
	import { toScale } from '#lib/labels.ts';
	import { postAction, toast } from '#lib/toast.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const m = $derived(data.media);
	const ep = $derived(data.episode);
	const scale = $derived(data.ratingScale);
	const mediaHref = $derived(resolve('/(app)/media/[id]', { id: String(m.id) }));
	const episodeHref = (id: number) =>
		resolve('/(app)/media/[id]/episodes/[episodeId]', {
			id: String(m.id),
			episodeId: String(id)
		});
	// Stars count in halves: 1 to 10 half-stars
	const rated = $derived(ep.myScore == null ? 0 : Math.round(ep.myScore / 10));

	let busy = $state(false);
	async function send(action: 'episode' | 'rate', fields: Record<string, string | number>) {
		busy = true;
		const res = await postAction(`?/${action}`, fields).catch(() => null);
		const result = res?.ok ? await res.json() : null;
		await invalidateAll();
		busy = false;
		if (result?.type !== 'success') toast('Échec, réessaie.');
	}
	// Clicking the current rating again clears it
	const rate = (h: number) => send('rate', { score: h === rated ? '' : toScale(h * 10, scale) });
</script>

<svelte:head><title>{ep.label} · {m.title} · Vulu</title></svelte:head>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:py-10">
	<a
		href="{mediaHref}{ep.seasonId ? `?saison=${ep.seasonId}` : ''}#episodes-title"
		class="flex items-center gap-3 self-start text-sm text-muted no-underline"
	>
		<Poster src={m.posterUrl} title={m.title} type={m.type} class="w-10 rounded-md" />
		<span
			><span class="block font-semibold text-ink">{m.title}</span>{ep.seasonNumber === null
				? 'Épisodes'
				: ep.seasonNumber === 0
					? 'Épisodes spéciaux'
					: `Saison ${ep.seasonNumber}`}</span
		>
	</a>

	{#if ep.stillUrl}
		<img
			src={ep.stillUrl}
			alt=""
			class="aspect-video w-full rounded-2xl bg-surface-2 object-cover"
			referrerpolicy="no-referrer"
		/>
	{/if}

	<header class="flex flex-col gap-2">
		<p class="text-sm font-semibold text-muted tabular-nums">{ep.label}</p>
		<h1
			class="font-display text-[26px] leading-[1.05] font-extrabold tracking-tight text-balance sm:text-[40px]"
		>
			{ep.title ?? `Épisode ${ep.number}`}
		</h1>
		<p class="text-muted">
			{[
				ep.airDate && (ep.aired ? `Diffusé le ${ep.airDate}` : `Diffusion le ${ep.airDate}`),
				ep.runtimeMinutes ? `${ep.runtimeMinutes} min` : null
			]
				.filter(Boolean)
				.join(' · ')}
		</p>
	</header>

	{#if ep.overview}
		<p class="leading-relaxed">{ep.overview}</p>
	{/if}

	{#if data.user}
		<section aria-label="Suivi" class="flex flex-wrap items-center justify-between gap-4 card p-4">
			<div class="flex flex-col gap-1">
				<button
					type="button"
					aria-pressed={ep.seen}
					disabled={busy || !ep.aired}
					class="{ep.seen ? 'btn-ink' : 'btn-ghost'} self-start"
					onclick={() => send('episode', { seen: String(!ep.seen) })}
					>{ep.seen ? 'Vu' : 'Pas vu'}</button
				>
				{#if ep.seenOn.length}
					<span class="text-xs text-muted">Vu le {ep.seenOn.join(', ')}</span>
				{:else if !ep.aired}
					<span class="text-xs text-muted">Pas encore diffusé</span>
				{/if}
			</div>
			<div class="flex flex-col items-end gap-1">
				<span class="text-[13px] font-semibold text-muted">Ma note</span>
				<StarRating {rated} onrate={rate} />
			</div>
		</section>
	{:else}
		<p class="text-sm text-muted">
			<a href="{resolve('login')}?redirectTo={encodeURIComponent(episodeHref(ep.id))}"
				>Connecte-toi</a
			> pour marquer cet épisode comme vu et le noter.
		</p>
	{/if}

	<p class="text-sm text-muted">
		{#if ep.community.count && ep.community.average !== null}
			Note des membres : <strong class="text-ink"
				>★ {toScale(ep.community.average, scale)}/{scale}</strong
			>
			({ep.community.count}
			{ep.community.count > 1 ? 'notes' : 'note'})
		{:else}
			Pas encore de note des membres.
		{/if}
	</p>

	<nav aria-label="Épisodes voisins" class="flex justify-between gap-3">
		{#if ep.previous}
			<a href={episodeHref(ep.previous.id)} class="btn-ghost min-w-0 no-underline"
				>← <span class="truncate">{ep.previous.label}</span></a
			>
		{:else}<span></span>{/if}
		{#if ep.next}
			<a href={episodeHref(ep.next.id)} class="btn-ghost min-w-0 no-underline"
				><span class="truncate">{ep.next.label}</span> →</a
			>
		{/if}
	</nav>
</div>
