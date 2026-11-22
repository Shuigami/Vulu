<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Avatar from '#lib/components/Avatar.svelte';
	import Meta from '#lib/components/Meta.svelte';
	import Poster from '#lib/components/Poster.svelte';
	import ShareButton from '#lib/components/ShareButton.svelte';
	import { toScale } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const other = $derived(data.other);
	const me = $derived(data.me);
	const r = $derived(data.result);
	const scale = $derived(data.ratingScale);
	const sharePath = $derived(me ? `/u/${other.username}/compat?avec=${me.username}` : '');
	const back = $derived(page.url.pathname + page.url.search);
	const score = (s: number) => `${toScale(s, scale)}/${scale}`;
</script>

<Meta
	title={me ? `${me.name} & ${other.name}` : `Compatibilité avec ${other.name}`}
	description={r?.percent != null
		? `${r.percent} % compatibles sur ${r.shared} œuvres notées en commun. ${data.verdict}.`
		: `Compare tes goûts en films, séries, anime, mangas et livres avec ${other.name} sur Vulu.`}
	card={me
		? `${sharePath.replace('/compat?', '/compat/card.png?')}`
		: `/u/${other.username}/card.png`}
/>

<div class="flex flex-col items-center gap-8 text-center">
	<div class="flex items-center">
		{#if me}<Avatar
				src={me.avatarUrl}
				name={me.name}
				class="size-20 text-3xl ring-4 ring-bg"
			/>{/if}
		<Avatar
			src={other.avatarUrl}
			name={other.name}
			class="size-20 text-3xl ring-4 ring-bg {me ? '-ml-5' : ''}"
		/>
	</div>
	<p class="eyebrow">
		{me ? `${data.isViewer ? 'Toi' : me.name} & ${other.name}` : `Toi & ${other.name}`}
	</p>

	{#if !me}
		<!-- Signed out: the score is hidden behind sign-up -->
		<p
			class="font-display text-[96px] leading-none font-extrabold text-accent-ink blur-md select-none"
			aria-hidden="true"
		>
			87 %
		</p>
		<p class="max-w-md text-lg">
			À quel point tes goûts collent-ils à ceux de {other.name} ? Crée ton compte, note quelques œuvres
			et découvre-le.
		</p>
		<div class="flex flex-wrap justify-center gap-2">
			<a href={resolve('signup')} class="btn-accent px-6">Créer mon compte</a>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- query on a resolved path -->
			<a href={`${resolve('login')}?redirectTo=${encodeURIComponent(back)}`} class="btn-ghost"
				>Se connecter</a
			>
		</div>
	{:else if !r}
		<p class="text-muted">C’est toi ! Compare-toi plutôt avec quelqu’un d’autre.</p>
	{:else if r.percent === null}
		<p class="font-display text-[40px] leading-tight font-extrabold">
			Pas encore assez d’œuvres en commun
		</p>
		<p class="max-w-md text-muted">
			{r.shared}
			{r.shared > 1 ? 'œuvres notées' : 'œuvre notée'} par vous deux : il en faut au moins 3.
		</p>
	{:else}
		<div class="flex flex-col items-center gap-2">
			<p
				class="font-display text-[96px] leading-none font-extrabold text-accent-ink sm:text-[140px]"
			>
				{r.percent}&nbsp;%
			</p>
			<p class="font-display text-2xl font-bold">{data.verdict}</p>
			<p class="text-sm text-muted">Sur {r.shared} œuvres notées par vous deux</p>
		</div>
	{/if}

	{#if me && r}
		<div class="flex flex-wrap justify-center gap-2">
			<ShareButton title={`${me.name} & ${other.name}`} path={sharePath} class="btn-accent" />
			<a href={resolve('/(app)/u/[username]', { username: other.username })} class="btn-ghost"
				>Profil de {other.name}</a
			>
		</div>
	{/if}
</div>

{#if r?.loved.length}
	<section aria-labelledby="loved" class="mt-12 flex flex-col gap-5">
		<h2 id="loved" class="h2">Vous avez adoré tous les deux</h2>
		<ul class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-4">
			{#each r.loved as l (l.mediaId)}
				<li>
					<a
						href={resolve('/(app)/media/[id]', { id: String(l.mediaId) })}
						class="group flex flex-col gap-1.5 text-sm text-ink no-underline"
					>
						<Poster src={l.posterUrl} title={l.title} class="w-full rounded-[10px] tile-frame" />
						<span class="leading-tight font-semibold group-hover:underline">{l.title}</span>
						<span class="text-[13px] text-muted">★ {score(l.a)} · ★ {score(l.b)}</span>
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if me && r?.clashes.length}
	<section aria-labelledby="clashes" class="mt-12 flex flex-col gap-4">
		<h2 id="clashes" class="h2">Là où ça coince</h2>
		<ul class="flex flex-col gap-3">
			{#each r.clashes as c (c.mediaId)}
				<li class="flex items-center gap-4 card p-3">
					<Poster src={c.posterUrl} title={c.title} class="w-12 rounded-lg" />
					<a
						href={resolve('/(app)/media/[id]', { id: String(c.mediaId) })}
						class="min-w-0 flex-1 font-semibold text-ink">{c.title}</a
					>
					<span class="text-right text-sm">
						<span class="block">{data.isViewer ? 'Toi' : me.name} : ★ {score(c.a)}</span>
						<span class="block text-muted">{other.name} : ★ {score(c.b)}</span>
					</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}
