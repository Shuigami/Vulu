<script lang="ts">
	import { resolve } from '$app/paths';
	import { openSearch } from '#lib/search-ui.svelte.ts';

	/** Empty library or nothing in progress: points to the two ways of filling it. */
	let { title }: { title: string } = $props();
</script>

<div class="flex flex-col items-start gap-4 card p-6">
	<div class="flex flex-col gap-1">
		<p class="font-display text-lg font-bold">{title}</p>
		<p class="text-sm text-muted">
			Cherche une œuvre pour l’ajouter, ou récupère ta bibliothèque depuis AniList, MyAnimeList,
			Trakt ou Goodreads.
		</p>
	</div>
	<div class="flex flex-wrap gap-2">
		<button type="button" class="btn-accent" onclick={openSearch}>Chercher une œuvre</button>
		<a href={resolve('import')} class="btn-ghost">Importer ma bibliothèque</a>
	</div>
</div>
