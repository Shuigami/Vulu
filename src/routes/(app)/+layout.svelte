<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { authClient } from '#lib/auth-client.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const links = [
		{ href: resolve(''), label: 'En cours' },
		{ href: resolve('library'), label: 'Bibliothèque' },
		{ href: resolve('calendar'), label: 'Calendrier' },
		{ href: resolve('import'), label: 'Importer' }
	];

	async function signOut() {
		await authClient.signOut();
		await invalidateAll();
		await goto(resolve('login'));
	}
</script>

<header class="border-b border-gray-200">
	<div class="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
		<a href={resolve('')} class="font-semibold">Vulu</a>
		<nav class="flex gap-3 text-sm">
			{#each links as link (link.href)}
				<a
					href={link.href}
					class="hover:text-gray-900 {page.url.pathname === link.href
						? 'font-medium text-gray-900'
						: 'text-gray-600'}"
					aria-current={page.url.pathname === link.href ? 'page' : undefined}>{link.label}</a
				>
			{/each}
		</nav>
		<form action={resolve('search')} method="get" role="search" class="min-w-40 flex-1">
			<input
				type="search"
				name="q"
				value={page.url.pathname === resolve('search') ? page.url.searchParams.get('q') : ''}
				placeholder="Rechercher un film, une série, un livre…"
				aria-label="Rechercher"
				class="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
			/>
		</form>
		<div class="flex items-center gap-3 text-sm">
			<span>{data.user.displayName || data.user.username}</span>
			<button type="button" class="text-gray-600 underline hover:text-gray-900" onclick={signOut}>
				Se déconnecter
			</button>
		</div>
	</div>
</header>

<main class="mx-auto max-w-3xl p-4">
	{@render children()}
</main>

<footer class="mx-auto max-w-3xl px-4 py-8 text-xs text-gray-500">
	<p>
		Données et images :
		<a href="https://www.themoviedb.org" class="underline" rel="external">TMDB</a>,
		<a href="https://anilist.co" class="underline" rel="external">AniList</a> et
		<a href="https://openlibrary.org" class="underline" rel="external">Open Library</a>.
	</p>
	<p>Ce produit utilise l’API TMDB mais n’est ni approuvé ni certifié par TMDB.</p>
</footer>
