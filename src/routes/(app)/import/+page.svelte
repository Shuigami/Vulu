<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { typeLabel } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let sending = $state<string | null>(null);

	const sourceLabel: Record<string, string> = { anilist: 'AniList', goodreads: 'Goodreads' };
	const statusText: Record<string, string> = {
		pending: 'En attente',
		running: 'En cours…',
		done: 'Terminé',
		failed: 'Échec'
	};
	const errorText: Record<string, string> = {
		anilist_user_not_found: 'Profil AniList introuvable ou privé.'
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

<h1 class="text-xl font-semibold">Importer ma bibliothèque</h1>
<p class="mt-1 text-sm text-gray-600">
	Les œuvres déjà présentes dans ta bibliothèque Vulu ne sont pas modifiées.
</p>

{#if form?.error}<p role="alert" class="mt-3 text-sm text-red-600">{form.error}</p>{/if}
{#if form?.started}<p role="status" class="mt-3 text-sm text-green-700">Import lancé.</p>{/if}

<div class="mt-4 grid gap-4 sm:grid-cols-2">
	<form
		method="post"
		action="?/anilist"
		use:enhance={submit('anilist')}
		class="flex flex-col gap-2 rounded border border-gray-200 p-4"
	>
		<h2 class="font-medium">AniList</h2>
		<p class="text-sm text-gray-600">Anime et mangas de ton profil public.</p>
		<label class="flex flex-col gap-1 text-sm">
			Pseudo AniList
			<input
				name="userName"
				required
				autocomplete="off"
				class="rounded border border-gray-300 px-2 py-1.5"
			/>
		</label>
		<button
			disabled={sending !== null || active}
			class="mt-auto rounded bg-gray-900 px-3 py-2 text-white disabled:opacity-50"
		>
			Importer depuis AniList
		</button>
	</form>

	<form
		method="post"
		action="?/goodreads"
		enctype="multipart/form-data"
		use:enhance={submit('goodreads')}
		class="flex flex-col gap-2 rounded border border-gray-200 p-4"
	>
		<h2 class="font-medium">Goodreads</h2>
		<p class="text-sm text-gray-600">
			Sur Goodreads : Mes livres, puis Import and export, puis Export Library. Envoie le fichier CSV
			obtenu.
		</p>
		<label class="flex flex-col gap-1 text-sm">
			Fichier CSV
			<input name="file" type="file" accept=".csv,text/csv" required class="text-sm" />
		</label>
		<button
			disabled={sending !== null || active}
			class="mt-auto rounded bg-gray-900 px-3 py-2 text-white disabled:opacity-50"
		>
			Importer depuis Goodreads
		</button>
	</form>
</div>

{#if data.jobs.length}
	<h2 class="mt-8 font-medium">Imports récents</h2>
	<ul class="mt-2 divide-y divide-gray-100">
		{#each data.jobs as job (job.id)}
			<li class="py-3 text-sm">
				<p>
					<span class="font-medium">{sourceLabel[job.source] ?? job.source}</span>
					· {dateFormat.format(new Date(job.createdAt))} · {statusText[job.status]}
				</p>
				{#if job.status === 'done'}
					<p class="text-gray-600">
						{job.stats.imported ?? 0} ajoutée(s), {job.stats.kept ?? 0} déjà présente(s), {job.stats
							.unmatched ?? 0} non retrouvée(s) sur {job.stats.total ?? 0}.
					</p>
				{:else if job.status === 'failed'}
					<p class="text-red-600">
						{errorText[job.error ?? ''] ?? 'L’import a échoué. Réessaie plus tard.'}
					</p>
				{/if}
				{#if job.unmatched.length}
					<details class="mt-1">
						<summary class="cursor-pointer text-gray-600">
							Œuvres non retrouvées ({job.unmatched.length}) : à ajouter à la main
						</summary>
						<ul class="mt-1 ml-4 list-disc">
							{#each job.unmatched as u, i (i)}
								<li>
									{u.label} ({typeLabel[u.type]}) ·
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- searchHref uses resolve() -->
									<a href={searchHref(u.label, u.type)} class="underline">chercher</a>
								</li>
							{/each}
						</ul>
					</details>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
