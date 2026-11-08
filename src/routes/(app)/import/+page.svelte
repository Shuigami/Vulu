<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { typeLabel } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let sending = $state<string | null>(null);

	const sourceLabel: Record<string, string> = {
		anilist: 'AniList',
		goodreads: 'Goodreads',
		mal: 'MyAnimeList',
		trakt: 'Trakt'
	};
	const statusText: Record<string, string> = {
		pending: 'En attente',
		running: 'En cours…',
		done: 'Terminé',
		failed: 'Échec'
	};
	const errorText: Record<string, string> = {
		anilist_user_not_found: 'Profil AniList introuvable ou privé.',
		trakt_user_not_found: 'Profil Trakt introuvable ou privé.',
		trakt_not_configured: 'L’import Trakt n’est pas configuré sur ce serveur.'
	};
	const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

	// Refresh while an import is running, so its result shows up without reloading
	const active = $derived(data.jobs.some((j) => j.status === 'pending' || j.status === 'running'));
	$effect(() => {
		if (!active) return;
		const timer = setInterval(() => invalidateAll(), 4000);
		return () => clearInterval(timer);
	});

	const submit = (name: string) => () => {
		sending = name;
		return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
			await update();
			sending = null;
		};
	};
	const searchHref = (label: string, type: string) =>
		`${resolve('search')}?${new URLSearchParams({ q: label.split(' — ')[0], type })}`;
</script>

<svelte:head><title>Importer · Vulu</title></svelte:head>

<h1 class="h1">Importer ma bibliothèque</h1>
<p class="mt-2.5 text-muted">
	Les œuvres déjà présentes dans ta bibliothèque Vulu ne sont pas modifiées.
</p>

{#if form?.error}<p role="alert" class="mt-3 text-sm text-danger">{form.error}</p>{/if}
{#if form?.started}<p role="status" class="mt-3 text-sm text-success">Import lancé.</p>{/if}

<div class="mt-7 grid gap-4 sm:grid-cols-2">
	<form
		method="post"
		action="?/anilist"
		use:enhance={submit('anilist')}
		class="flex flex-col gap-3 card p-5"
	>
		<h2 class="h2">AniList</h2>
		<p class="text-sm text-muted">Anime et mangas de ton profil public.</p>
		<label class="flex flex-col gap-1.5 text-[13px] text-muted">
			Pseudo AniList
			<input name="userName" required autocomplete="off" class="field" />
		</label>
		<button disabled={sending !== null || active} class="mt-auto btn-accent">
			Importer depuis AniList
		</button>
	</form>

	<form
		method="post"
		action="?/goodreads"
		enctype="multipart/form-data"
		use:enhance={submit('goodreads')}
		class="flex flex-col gap-3 card p-5"
	>
		<h2 class="h2">Goodreads</h2>
		<p class="text-sm text-muted">
			Sur Goodreads : Mes livres, puis Import and export, puis Export Library. Envoie le fichier CSV
			obtenu.
		</p>
		<label class="flex flex-col gap-1.5 text-[13px] text-muted">
			Fichier CSV
			<input
				name="file"
				type="file"
				accept=".csv,text/csv"
				required
				class="text-sm text-ink file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface-2 file:px-3 file:py-2 file:text-ink"
			/>
		</label>
		<button disabled={sending !== null || active} class="mt-auto btn-accent">
			Importer depuis Goodreads
		</button>
	</form>

	<form
		method="post"
		action="?/mal"
		enctype="multipart/form-data"
		use:enhance={submit('mal')}
		class="flex flex-col gap-3 card p-5"
	>
		<h2 class="h2">MyAnimeList</h2>
		<p class="text-sm text-muted">
			Sur MyAnimeList : profil, puis Export. Envoie le fichier .xml.gz (anime ou manga, un à la
			fois).
		</p>
		<label class="flex flex-col gap-1.5 text-[13px] text-muted">
			Fichier d’export
			<input
				name="file"
				type="file"
				accept=".xml,.gz,.xml.gz"
				required
				class="text-sm text-ink file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface-2 file:px-3 file:py-2 file:text-ink"
			/>
		</label>
		<button disabled={sending !== null || active} class="mt-auto btn-accent">
			Importer depuis MyAnimeList
		</button>
	</form>

	<form
		method="post"
		action="?/trakt"
		use:enhance={submit('trakt')}
		class="flex flex-col gap-3 card p-5"
	>
		<h2 class="h2">Trakt</h2>
		<p class="text-sm text-muted">Films et séries vus, notes et watchlist de ton profil public.</p>
		{#if data.traktEnabled}
			<label class="flex flex-col gap-1.5 text-[13px] text-muted">
				Pseudo Trakt
				<input name="userName" required autocomplete="off" class="field" />
			</label>
			<button disabled={sending !== null || active} class="mt-auto btn-accent">
				Importer depuis Trakt
			</button>
		{:else}
			<p class="text-sm text-accent-ink">Pas encore disponible sur ce serveur.</p>
		{/if}
	</form>
</div>

{#if data.jobs.length}
	<h2 class="mt-10 h2">Imports récents</h2>
	<ul class="mt-3 divide-y divide-line">
		{#each data.jobs as job (job.id)}
			<li class="py-3 text-sm">
				<p>
					<span class="font-medium">{sourceLabel[job.source] ?? job.source}</span>
					· {dateFormat.format(new Date(job.createdAt))} · {statusText[job.status]}
				</p>
				{#if job.status === 'done'}
					<p class="text-muted">
						{job.stats.imported ?? 0} ajoutée(s), {job.stats.kept ?? 0} déjà présente(s), {job.stats
							.unmatched ?? 0} non retrouvée(s) sur {job.stats.total ?? 0}.
					</p>
				{:else if job.status === 'failed'}
					<p class="text-danger">
						{errorText[job.error ?? ''] ?? 'L’import a échoué. Réessaie plus tard.'}
					</p>
				{/if}
				{#if job.unmatched.length}
					<details class="mt-1">
						<summary class="cursor-pointer text-muted">
							Œuvres non retrouvées ({job.unmatched.length}) : à ajouter à la main
						</summary>
						<ul class="mt-1 ml-4 list-disc">
							{#each job.unmatched as u, i (i)}
								<li>
									{u.label} ({typeLabel[u.type]}) ·
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- searchHref uses resolve() -->
									<a href={searchHref(u.label, u.type)} class="cursor-pointer text-ink underline"
										>chercher</a
									>
								</li>
							{/each}
						</ul>
					</details>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
