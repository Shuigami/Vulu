<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { authClient } from '#lib/auth-client.ts';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const links = [
		{ href: resolve(''), label: 'Accueil' },
		{ href: resolve('activity'), label: 'Activité' },
		{ href: resolve('library'), label: 'Bibliothèque' },
		{ href: resolve('calendar'), label: 'Calendrier' },
		{ href: resolve('import'), label: 'Importer' },
		{ href: resolve('integrations'), label: 'Intégrations' }
	];

	async function signOut() {
		await authClient.signOut();
		await invalidateAll();
		await goto(resolve('login'));
	}
</script>

<header class="border-b border-line">
	<div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-7 gap-y-3 px-4 py-3.5 sm:px-6">
		<a
			href={resolve('')}
			class="font-display text-[26px] font-extrabold tracking-tight text-ink no-underline"
			>vulu<span class="text-accent">.</span></a
		>
		<nav aria-label="Navigation principale" class="flex flex-wrap gap-1 text-sm">
			{#each links as link (link.href)}
				{@const current = page.url.pathname === link.href}
				<a
					href={link.href}
					class="rounded-[10px] px-3.5 py-2.5 no-underline {current
						? 'bg-surface-2 font-semibold text-ink'
						: 'text-muted hover:text-ink'}"
					aria-current={current ? 'page' : undefined}>{link.label}</a
				>
			{/each}
		</nav>
		<form
			action={resolve('search')}
			method="get"
			role="search"
			class="flex h-11 min-w-0 flex-[1_1_240px] items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 focus-within:border-accent"
		>
			<svg
				aria-hidden="true"
				class="shrink-0 text-muted"
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg
			>
			<input
				type="search"
				name="q"
				value={page.url.pathname === resolve('search') ? page.url.searchParams.get('q') : ''}
				placeholder="Film, série, anime, manga, livre…"
				aria-label="Rechercher"
				class="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
			/>
		</form>
		<div class="flex items-center gap-3 text-sm">
			<ThemeToggle />
			<a
				href={resolve('/(app)/u/[username]', { username: data.user.username })}
				class="font-semibold text-ink no-underline hover:underline"
				>{data.user.displayName || data.user.username}</a
			>
			<button
				type="button"
				class="cursor-pointer text-muted underline hover:text-ink"
				onclick={signOut}
			>
				Se déconnecter
			</button>
		</div>
	</div>
</header>

<main class="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
	{@render children()}
</main>

<footer class="mx-auto max-w-6xl border-t border-line px-4 pt-8 pb-12 text-xs text-muted sm:px-6">
	<p>
		Données et images :
		<a href="https://www.themoviedb.org" rel="external">TMDB</a>,
		<a href="https://anilist.co" rel="external">AniList</a> et
		<a href="https://openlibrary.org" rel="external">Open Library</a>. Ce produit utilise l’API TMDB
		mais n’est ni approuvé ni certifié par TMDB.
	</p>
</footer>
