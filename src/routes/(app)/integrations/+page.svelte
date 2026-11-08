<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let copied = $state<string | null>(null);

	const resultText: Record<string, string> = {
		updated: 'progression mise à jour',
		unchanged: 'déjà à jour',
		duplicate: 'doublon ignoré',
		unmatched: 'œuvre non reconnue',
		ignored: 'pas vu en entier'
	};
	const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

	async function copy(text: string, what: string) {
		await navigator.clipboard.writeText(text);
		copied = what;
		setTimeout(() => (copied = null), 2000);
	}
	const field = 'field';
</script>

<svelte:head><title>Intégrations · Vulu</title></svelte:head>

<h1 class="h1">Intégrations</h1>

<section class="mt-7 max-w-3xl card p-6" aria-labelledby="jellyfin-title">
	<h2 id="jellyfin-title" class="h2">Jellyfin</h2>
	<p class="mt-2.5 text-muted">
		Coche automatiquement les films et épisodes que tu finis de regarder sur ton serveur Jellyfin.
	</p>

	{#if !data.jellyfin}
		<form method="post" action="?/create" use:enhance class="mt-3">
			<button class="btn-accent">Activer Jellyfin</button>
		</form>
	{:else}
		<ol class="mt-4 list-decimal space-y-3 pl-5 text-sm">
			<li>
				Dans Jellyfin : Tableau de bord, Extensions, Catalogue, installe l’extension
				<strong>Webhook</strong>, puis redémarre le serveur.
			</li>
			<li>
				Dans les réglages de l’extension, ajoute une destination <strong>Generic</strong> avec cette
				URL :
				<div class="mt-1 flex gap-2">
					<input
						readonly
						value={data.jellyfin.webhookUrl}
						class="{field} min-w-0 flex-1 font-mono text-xs"
						aria-label="URL du webhook"
					/>
					<button
						type="button"
						class="btn-ghost min-h-10 px-3 text-xs"
						onclick={() => copy(data.jellyfin!.webhookUrl, 'url')}
					>
						{copied === 'url' ? 'Copié' : 'Copier'}
					</button>
				</div>
				<p class="mt-1 text-xs text-muted">
					Garde cette URL secrète : elle suffit pour modifier ta bibliothèque. Si Jellyfin tourne
					sur une autre machine ou dans Docker, remplace « localhost » par l’adresse réseau de ce
					serveur (par exemple 192.168.1.x) : dans un conteneur, « localhost » désigne le conteneur
					lui-même.
				</p>
			</li>
			<li>
				Coche les notifications <strong>Playback Stop</strong> et <strong>User Data Saved</strong>,
				et les types <strong>Movies</strong> et <strong>Episodes</strong>.
			</li>
			<li>
				Colle ce modèle dans « Template » :
				<div class="relative mt-1">
					<pre class="overflow-x-auto rounded-xl bg-surface-2 p-3 text-xs">{data.template}</pre>
					<button
						type="button"
						class="absolute top-1.5 right-1.5 btn-ghost min-h-9 px-3 text-xs"
						onclick={() => copy(data.template, 'template')}
					>
						{copied === 'template' ? 'Copié' : 'Copier'}
					</button>
				</div>
			</li>
		</ol>

		<form
			method="post"
			action="?/save"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="mt-4 flex flex-wrap items-end gap-3 text-sm"
		>
			<label class="flex flex-col gap-1">
				Utilisateur Jellyfin (facultatif)
				<input
					name="jellyfinUser"
					value={data.jellyfin.jellyfinUser}
					placeholder="Tous les utilisateurs"
					class={field}
				/>
			</label>
			<label class="flex items-center gap-2 py-1.5">
				<input name="enabled" type="checkbox" checked={data.jellyfin.enabled} /> Activé
			</label>
			<button class="btn-ink">Enregistrer</button>
			{#if form?.saved}<span role="status" class="text-success">Enregistré.</span>{/if}
			{#if form?.error}<span role="alert" class="text-danger">{form.error}</span>{/if}
		</form>

		<h3 class="mt-7 eyebrow">Derniers événements reçus</h3>
		{#if data.jellyfin.recent.length}
			<ul class="mt-1 text-sm">
				{#each data.jellyfin.recent as e, i (i)}
					<li class="py-0.5">
						<span class="text-muted">{dateFormat.format(new Date(e.at))}</span> · {e.label} ·
						<span class={e.result === 'unmatched' ? 'text-accent-ink' : 'text-ink'}>
							{resultText[e.result] ?? e.result}
						</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-1 text-sm text-muted">
				Aucun pour l’instant. Regarde la fin d’un épisode sur Jellyfin pour vérifier.
			</p>
		{/if}

		<div class="mt-6 flex gap-4 text-sm">
			<form
				method="post"
				action="?/regenerate"
				use:enhance={({ cancel }) => {
					if (!confirm('L’ancienne URL cessera de fonctionner. Continuer ?')) cancel();
				}}
			>
				<button class="cursor-pointer text-ink underline">Générer une nouvelle URL</button>
			</form>
			<form
				method="post"
				action="?/remove"
				use:enhance={({ cancel }) => {
					if (!confirm('Supprimer l’intégration Jellyfin ?')) cancel();
				}}
			>
				<button class="cursor-pointer text-danger underline">Supprimer</button>
			</form>
		</div>
	{/if}
</section>
