<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	const notFound = $derived(page.status === 404);
	// SvelteKit's default messages are English; our own error(404, '…') messages are French
	const message = $derived(
		notFound
			? page.error?.message && page.error.message !== 'Not Found'
				? page.error.message
				: 'Cette page n’existe pas ou a été déplacée.'
			: 'Une erreur est survenue de notre côté. Réessaie dans un instant.'
	);
</script>

<svelte:head><title>{notFound ? 'Introuvable' : 'Erreur'} · Vulu</title></svelte:head>

<section class="mx-auto flex max-w-xl flex-col items-start gap-4 py-16">
	<p class="text-muted">Erreur {page.status}</p>
	<h1 class="font-display text-[40px] font-extrabold tracking-tight">
		{notFound ? 'Introuvable' : 'Oups'}
	</h1>
	<p>{message}</p>
	<div class="flex flex-wrap gap-3">
		<a href={resolve('')} class="btn-accent px-6">Retour à l’accueil</a>
		<a href={resolve('search')} class="btn-ghost">Rechercher</a>
	</div>
</section>
