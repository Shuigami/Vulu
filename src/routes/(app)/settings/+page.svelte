<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Avatar from '#lib/components/Avatar.svelte';
	import { MEDIA_TYPES, RATING_SCALES, typePlural, type MediaType } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let exportType = $state<MediaType | null>(null);
	let preview = $state<string | null>(null);
	$effect(() => {
		// A saved profile reloads data: drop the local preview
		void data.avatarUrl;
		preview = null;
	});

	/** Crops the picked image to a 256 px square in the browser, so the upload stays small. */
	async function pickAvatar(e: Event & { currentTarget: HTMLInputElement }) {
		const input = e.currentTarget;
		const file = input.files?.[0];
		if (!file) return;
		const bitmap = await createImageBitmap(file);
		const side = Math.min(bitmap.width, bitmap.height);
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 256;
		canvas
			.getContext('2d')!
			.drawImage(
				bitmap,
				(bitmap.width - side) / 2,
				(bitmap.height - side) / 2,
				side,
				side,
				0,
				0,
				256,
				256
			);
		const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.85));
		if (!blob) return;
		const files = new DataTransfer();
		files.items.add(new File([blob], 'avatar', { type: blob.type }));
		input.files = files.files;
		preview = URL.createObjectURL(blob);
	}
	const options = [
		{
			value: 'public',
			label: 'Public',
			help: 'Les membres voient ton profil, tes notes et ton activité, et peuvent s’abonner.'
		},
		{ value: 'private', label: 'Privé', help: 'Personne d’autre ne voit ta bibliothèque.' }
	];
	const scaleHelp: Record<number, string> = {
		5: 'Comme des étoiles, demi-points possibles.',
		10: 'Demi-points possibles.',
		100: 'Comme sur AniList.'
	};

	// Theme: stored in the `theme` cookie (read by hooks.server.ts); "system" removes it
	const themes = [
		{ value: 'system', label: 'Système' },
		{ value: 'light', label: 'Clair' },
		{ value: 'dark', label: 'Sombre' }
	] as const;
	let theme = $derived(data.theme);
	function setTheme(value: typeof theme) {
		theme = value;
		const root = document.documentElement;
		if (value === 'system') {
			delete root.dataset.theme;
			document.cookie = 'theme=; path=/; max-age=0; samesite=lax';
		} else {
			root.dataset.theme = value;
			document.cookie = `theme=${value}; path=/; max-age=31536000; samesite=lax`;
		}
	}
</script>

<svelte:head><title>Réglages · Vulu</title></svelte:head>

<div class="flex max-w-xl flex-col gap-7">
	<h1 class="sr-only">Réglages</h1>
	<form
		method="post"
		action="?/profile"
		enctype="multipart/form-data"
		use:enhance={() =>
			({ update }) =>
				update({ reset: false })}
		class="flex flex-col gap-5 card p-5"
		aria-labelledby="profile-title"
	>
		<h2 id="profile-title" class="h2">Profil</h2>
		<div class="flex items-center gap-4">
			<Avatar
				src={preview ?? data.avatarUrl}
				name={data.displayName || data.user!.username}
				class="size-20 text-3xl"
			/>
			<div class="flex flex-wrap gap-2">
				<label class="btn-ghost cursor-pointer focus-within:outline-2 focus-within:outline-accent">
					Changer la photo
					<input
						type="file"
						name="avatar"
						accept="image/png,image/jpeg,image/webp"
						class="sr-only"
						onchange={pickAvatar}
					/>
				</label>
				{#if data.avatarUrl && !preview}
					<button class="btn-ghost" formaction="?/removeAvatar">Retirer</button>
				{/if}
			</div>
		</div>
		<label class="flex flex-col gap-1.5 text-sm">
			<span class="font-semibold">Nom affiché</span>
			<input
				name="displayName"
				value={data.displayName ?? ''}
				maxlength="50"
				placeholder={data.user!.username}
				class="h-11 rounded-xl border border-line bg-surface px-3.5 text-ink outline-none focus:border-accent"
			/>
			<span class="text-[13px] text-muted">Ton identifiant reste @{data.user!.username}.</span>
		</label>
		<div class="flex items-center gap-3">
			<button class="btn-ink">Enregistrer</button>
			{#if form?.profileError}<p role="alert" class="text-sm text-danger">
					{form.profileError}
				</p>{/if}
			{#if form?.profileSaved}<p role="status" class="text-sm text-success">Enregistré.</p>{/if}
		</div>
	</form>

	<form
		method="post"
		action="?/preferences"
		use:enhance={() =>
			({ update }) =>
				update({ reset: false })}
		class="flex flex-col gap-6 card p-5"
	>
		<fieldset class="flex flex-col gap-2">
			<legend class="mb-2 h2">Visibilité du profil</legend>
			{#each options as o (o.value)}
				<label class="flex min-h-11 items-start gap-2.5 text-sm">
					<input
						type="radio"
						name="profileVisibility"
						value={o.value}
						checked={(data.profileVisibility === 'private' ? 'private' : 'public') === o.value}
						class="mt-0.5 size-4 accent-accent"
					/>
					<span><strong>{o.label}</strong><br /><span class="text-muted">{o.help}</span></span>
				</label>
			{/each}
			<p class="text-[13px] text-muted">
				Une œuvre précise peut aussi être masquée depuis sa fiche (« Masquer de mon profil »).
			</p>
		</fieldset>
		<fieldset class="flex flex-col gap-2">
			<legend class="mb-2 h2">Échelle de notation</legend>
			{#each RATING_SCALES as s (s)}
				<label class="flex min-h-11 items-start gap-2.5 text-sm">
					<input
						type="radio"
						name="ratingScale"
						value={s}
						checked={data.ratingScale === s}
						class="mt-0.5 size-4 accent-accent"
					/>
					<span><strong>Sur {s}</strong><br /><span class="text-muted">{scaleHelp[s]}</span></span>
				</label>
			{/each}
			<p class="text-[13px] text-muted">Tes notes existantes sont converties, rien n’est perdu.</p>
		</fieldset>
		<div class="flex items-center gap-3">
			<button class="btn-ink">Enregistrer</button>
			{#if form?.error}<p role="alert" class="text-sm text-danger">{form.error}</p>{/if}
			{#if form?.saved}<p role="status" class="text-sm text-success">Enregistré.</p>{/if}
		</div>
	</form>

	<section class="flex flex-col gap-3 card p-5" aria-labelledby="theme-title">
		<h2 id="theme-title" class="h2">Apparence</h2>
		<div class="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="theme-title">
			{#each themes as t (t.value)}
				<button
					type="button"
					role="radio"
					aria-checked={theme === t.value}
					class={theme === t.value ? 'chip-on' : 'chip'}
					onclick={() => setTheme(t.value)}>{t.label}</button
				>
			{/each}
		</div>
		<p class="text-[13px] text-muted">
			« Système » suit le réglage clair ou sombre de ton appareil.
		</p>
	</section>

	<section class="flex flex-col gap-3 card p-5" aria-labelledby="export-title">
		<h2 id="export-title" class="h2">Exporter mes données</h2>
		<p class="text-sm text-muted">
			Ta bibliothèque, avec les identifiants TMDB, AniList, MAL et Open Library pour la réimporter
			ailleurs. Le JSON contient aussi ton historique.
		</p>
		<div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Types à exporter">
			{#each [null, ...MEDIA_TYPES] as t (t)}
				<button
					type="button"
					role="radio"
					aria-checked={exportType === t}
					class={exportType === t ? 'chip-on' : 'chip'}
					onclick={() => (exportType = t)}>{t ? typePlural[t] : 'Tout'}</button
				>
			{/each}
		</div>
		<div class="flex flex-wrap gap-3">
			{#each ['json', 'csv'] as format (format)}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- query on a resolved path -->
				<a
					class="btn-ink no-underline"
					href="{resolve('/(app)/settings/export.[format]', { format })}{exportType
						? `?type=${exportType}`
						: ''}"
					download>{format.toUpperCase()}</a
				>
			{/each}
		</div>
	</section>
</div>
