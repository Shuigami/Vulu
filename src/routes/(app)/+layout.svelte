<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { navigating, page } from '$app/state';
	import { authClient } from '#lib/auth-client.ts';
	import Avatar from '#lib/components/Avatar.svelte';
	import MediaSkeleton from '#lib/components/MediaSkeleton.svelte';
	import SearchBox from '#lib/components/SearchBox.svelte';
	import Toaster from '#lib/components/Toaster.svelte';
	import { opening } from '#lib/opening.svelte.ts';
	import { openSearch, searchUi } from '#lib/search-ui.svelte.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// Placeholder while a work loads, only past a short delay so fast loads do not flash
	const loadingMedia = $derived(opening.active || navigating.to?.route.id === '/(app)/media/[id]');
	let showSkeleton = $state(false);
	$effect(() => {
		if (!loadingMedia) return void (showSkeleton = false);
		const timer = setTimeout(() => {
			showSkeleton = true;
			scrollTo(0, 0);
		}, 150);
		return () => clearTimeout(timer);
	});

	// Main sections: in the header on wide screens, in the bottom tab bar on phones.
	// `icon` is the inner SVG markup of a 24x24 stroked icon.
	const links = [
		{
			href: resolve(''),
			label: 'Accueil',
			icon: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'
		},
		{
			href: resolve('library'),
			label: 'Bibliothèque',
			icon: '<rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="18" rx="1"/><path d="m17 4.2 2.9-.8 3 16.4-2.9.8z"/>'
		},
		{
			href: resolve('lists'),
			label: 'Listes',
			icon: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'
		},
		{
			href: resolve('calendar'),
			label: 'Calendrier',
			icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'
		}
	];
	// Less frequent pages: in the account menu
	const more = [
		{ href: resolve('activity'), label: 'Activité' },
		{ href: resolve('stats'), label: 'Statistiques' },
		{ href: resolve('import'), label: 'Importer' },
		{ href: resolve('integrations'), label: 'Intégrations' },
		{ href: resolve('settings'), label: 'Paramètres' }
	];
	const isCurrent = (href: string) =>
		href === resolve('') ? page.url.pathname === href : page.url.pathname.startsWith(href);

	let menu: HTMLDetailsElement | undefined = $state();
	// The account menu closes after navigating, on a click elsewhere, and on Escape
	$effect(() => {
		void page.url.pathname;
		if (menu) menu.open = false;
		searchUi.open = false;
	});

	async function signOut() {
		await authClient.signOut();
		await invalidateAll();
		await goto(resolve(''));
	}
</script>

<svelte:window
	onclick={(e) => {
		if (menu?.open && !e.composedPath().includes(menu)) menu.open = false;
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape' && menu?.open) {
			menu.open = false;
			menu.querySelector('summary')?.focus();
		}
	}}
/>

<header class="border-b border-line">
	<!-- Phones: one line (logo, magnifier, avatar); the magnifier swaps it for the search field -->
	<div class="mx-auto flex max-w-6xl items-center gap-x-3 px-4 py-3 sm:px-6 md:gap-x-7 md:py-3.5">
		<a
			href={resolve('')}
			class="font-display text-[26px] font-extrabold tracking-tight text-ink no-underline {searchUi.open
				? 'max-md:hidden'
				: ''}">vulu<span class="text-accent">.</span></a
		>
		<nav aria-label="Navigation principale" class="hidden gap-1 text-sm md:flex">
			{#each links as link (link.href)}
				{@const current = isCurrent(link.href)}
				<a
					href={link.href}
					class="rounded-[10px] px-3.5 py-2.5 no-underline {current
						? 'bg-surface-2 font-semibold text-ink'
						: 'text-muted hover:text-ink'}"
					aria-current={current ? 'page' : undefined}
					><!-- The hidden bold copy keeps the width fixed when the link becomes current --><span
						class="inline-grid"
						><span class="invisible col-start-1 row-start-1 font-semibold">{link.label}</span><span
							class="col-start-1 row-start-1">{link.label}</span
						></span
					></a
				>
			{/each}
		</nav>
		<SearchBox class="flex-[1_1_240px] {searchUi.open ? '' : 'max-md:hidden'}" />
		{#if searchUi.open}
			<button
				type="button"
				class="cursor-pointer text-sm font-semibold text-muted hover:text-ink md:hidden"
				onclick={() => (searchUi.open = false)}>Annuler</button
			>
		{/if}
		<div class="ml-auto flex items-center gap-2 {searchUi.open ? 'max-md:hidden' : ''}">
			<button
				type="button"
				aria-label="Ouvrir la recherche"
				class="flex size-10 cursor-pointer items-center justify-center rounded-full text-ink hover:bg-surface-2 md:hidden"
				onclick={openSearch}
				><svg
					aria-hidden="true"
					width="22"
					height="22"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg
				></button
			>
			{#if data.user}
				<details bind:this={menu} class="relative">
					<summary
						aria-label="Mon compte"
						class="flex cursor-pointer list-none items-center rounded-full border border-line p-0.5 hover:border-muted [&::-webkit-details-marker]:hidden"
					>
						<Avatar
							src={data.user.avatarUrl}
							name={data.user.displayName || data.user.username}
							class="size-9"
						/>
					</summary>
					<div class="absolute right-0 z-40 mt-2 flex w-60 flex-col card p-1.5 text-sm shadow-xl">
						<a
							href={resolve('/(app)/u/[username]', { username: data.user.username })}
							class="flex flex-col rounded-lg px-3 py-2.5 text-ink no-underline hover:bg-surface-2"
						>
							<span class="font-semibold">{data.user.displayName || data.user.username}</span>
							<span class="text-[13px] text-muted">Voir mon profil</span>
						</a>
						<div class="my-1 border-t border-line"></div>
						{#each more as link (link.href)}
							{@const current = isCurrent(link.href)}
							<a
								href={link.href}
								aria-current={current ? 'page' : undefined}
								class="flex min-h-10 items-center rounded-lg px-3 text-ink no-underline hover:bg-surface-2 {current
									? 'bg-surface-2 font-semibold'
									: ''}">{link.label}</a
							>
						{/each}
						<div class="my-1 border-t border-line"></div>
						<button
							type="button"
							class="flex min-h-10 cursor-pointer items-center rounded-lg px-3 text-left text-muted hover:bg-surface-2 hover:text-ink"
							onclick={signOut}>Se déconnecter</button
						>
					</div>
				</details>
			{:else}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved path plus a query string -->
				<a
					href="{resolve('login')}?redirectTo={encodeURIComponent(
						page.url.pathname + page.url.search
					)}"
					class="btn-accent px-4 text-sm no-underline">Se connecter</a
				>
			{/if}
		</div>
	</div>
</header>

<main class="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
	{#if showSkeleton}
		<MediaSkeleton />
	{:else}
		{@render children()}
	{/if}
</main>

<footer
	class="mx-auto max-w-6xl border-t border-line px-4 pt-8 pb-36 text-xs text-muted sm:px-6 md:pb-12"
>
	<p>
		Données et images :
		<a href="https://www.themoviedb.org" rel="external">TMDB</a>,
		<a href="https://anilist.co" rel="external">AniList</a> et
		<a href="https://openlibrary.org" rel="external">Open Library</a>. Ce produit utilise l’API TMDB
		mais n’est ni approuvé ni certifié par TMDB.
	</p>
	<p class="mt-2"><a href={resolve('privacy')}>Confidentialité</a></p>
</footer>

<nav
	aria-label="Navigation principale"
	class="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
>
	{#each links as link (link.href)}
		{@const current = isCurrent(link.href)}
		<a
			href={link.href}
			aria-current={current ? 'page' : undefined}
			class="flex min-h-15 flex-col items-center justify-center gap-1 text-[11px] font-semibold no-underline {current
				? 'text-ink'
				: 'text-muted'}"
		>
			<svg
				aria-hidden="true"
				width="22"
				height="22"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class={current ? 'text-accent-ink' : ''}
			>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- static icon markup defined above -->
				{@html link.icon}
			</svg>
			{link.label}
		</a>
	{/each}
</nav>

<Toaster />
