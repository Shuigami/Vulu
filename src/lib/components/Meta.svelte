<script lang="ts">
	import { page } from '$app/state';

	// Title and link previews (Open Graph, X). Only use data the load already filtered with
	// visibleTo: link crawlers are signed out, so they get a 404 for private profiles and lists.
	let {
		title,
		description = '',
		image = null,
		card = null,
		type = 'website'
	}: {
		title: string;
		description?: string | null;
		image?: string | null;
		/** A generated 1200x630 card (`…/card.png`), preferred over `image` */
		card?: string | null;
		type?: string;
	} = $props();

	const flat = $derived((description ?? '').replace(/\s+/g, ' ').trim());
	const desc = $derived(flat.length > 200 ? `${flat.slice(0, 199)}…` : flat);
	// Avatars are served by the app (relative URL); previews need absolute ones
	const src = $derived(card ?? image);
	const img = $derived(src ? new URL(src, page.url.origin).href : null);
</script>

<svelte:head>
	<title>{title} · Vulu</title>
	<meta property="og:site_name" content="Vulu" />
	<meta property="og:type" content={type} />
	<meta property="og:title" content={title} />
	<meta property="og:url" content={page.url.origin + page.url.pathname} />
	<!-- Posters and avatars are not wide: the small card does not crop them -->
	<meta name="twitter:card" content="summary" />
	{#if desc}
		<meta name="description" content={desc} />
		<meta property="og:description" content={desc} />
	{/if}
	{#if img}<meta property="og:image" content={img} />{/if}
</svelte:head>
