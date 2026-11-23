<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
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
		const ctx = canvas.getContext('2d')!;
		// JPEG has no transparency: a transparent PNG gets a white background, not black
		ctx.fillStyle = '#fff';
		ctx.fillRect(0, 0, 256, 256);
		ctx.drawImage(
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
		// JPEG, not WebP: share cards (resvg) cannot draw WebP avatars
		const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
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

	// Web push on this device. iOS only offers it to the app added to the home screen.
	type PushState = 'loading' | 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on' | 'busy';
	let push = $state<PushState>('loading');
	let pushError = $state<string | null>(null);

	onMount(async () => {
		const ios =
			/iPad|iPhone|iPod/.test(navigator.userAgent) ||
			(navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
		const standalone =
			matchMedia('(display-mode: standalone)').matches ||
			(navigator as { standalone?: boolean }).standalone === true;
		if (!('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window)) {
			push = ios && !standalone ? 'ios-install' : 'unsupported';
			return;
		}
		if (Notification.permission === 'denied') return void (push = 'denied');
		const registration = await navigator.serviceWorker.ready;
		push = (await registration.pushManager.getSubscription()) ? 'on' : 'off';
	});

	const fromBase64url = (text: string) =>
		Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

	async function enablePush() {
		pushError = null;
		push = 'busy';
		try {
			const permission = await Notification.requestPermission();
			if (permission !== 'granted') return void (push = permission === 'denied' ? 'denied' : 'off');
			const registration = await navigator.serviceWorker.ready;
			const subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: fromBase64url(data.notifications.vapidPublicKey!)
			});
			const res = await fetch(resolve('/(app)/settings/push'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(subscription)
			});
			if (!res.ok) {
				await subscription.unsubscribe();
				throw new Error(String(res.status));
			}
			push = 'on';
			await invalidateAll();
		} catch {
			push = 'off';
			pushError = 'Impossible d’activer les notifications sur cet appareil.';
		}
	}

	async function disablePush() {
		pushError = null;
		push = 'busy';
		const registration = await navigator.serviceWorker.ready;
		const subscription = await registration.pushManager.getSubscription();
		if (subscription) {
			await fetch(resolve('/(app)/settings/push'), {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ endpoint: subscription.endpoint })
			});
			await subscription.unsubscribe();
		}
		push = 'off';
		await invalidateAll();
	}

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

	<section class="flex flex-col gap-5 card p-5" aria-labelledby="notifications-title">
		<div class="flex flex-col gap-1">
			<h2 id="notifications-title" class="h2">Notifications de sorties</h2>
			<p class="text-sm text-muted">
				Chaque matin, les épisodes du jour des séries et anime que tu suis (à voir, en cours ou en
				pause).
			</p>
		</div>
		<form
			method="post"
			action="?/notifications"
			use:enhance={() =>
				({ update }) =>
					update({ reset: false })}
			class="flex flex-col gap-3"
		>
			<label class="flex min-h-11 items-start gap-2.5 text-sm">
				<input
					type="checkbox"
					name="releaseEmail"
					checked={data.notifications.releaseEmail}
					class="mt-0.5 size-4 accent-accent"
				/>
				<span
					><strong>Par e-mail</strong><br /><span class="text-muted"
						>Un e-mail à {data.email} les jours où quelque chose sort.</span
					></span
				>
			</label>
			<div class="flex items-center gap-3">
				<button class="btn-ink">Enregistrer</button>
				{#if form?.notificationsSaved}<p role="status" class="text-sm text-success">
						Enregistré.
					</p>{/if}
			</div>
		</form>

		{#if data.notifications.vapidPublicKey}
			<div class="flex flex-col gap-3 border-t border-line pt-5">
				<div class="text-sm">
					<strong>Sur cet appareil</strong><br />
					<span class="text-muted">
						{#if push === 'on'}
							Activées : tu recevras une notification les jours de sortie.
						{:else if push === 'ios-install'}
							Sur iPhone et iPad, ajoute d’abord Vulu à l’écran d’accueil (bouton Partager, « Sur
							l’écran d’accueil »), puis ouvre Vulu depuis son icône et reviens ici.
						{:else if push === 'unsupported'}
							Ce navigateur ne gère pas les notifications.
						{:else if push === 'denied'}
							Les notifications sont bloquées pour Vulu : autorise-les dans les réglages du
							navigateur, puis recharge la page.
						{:else}
							Une notification sur ton téléphone ou ton ordinateur, même quand Vulu est fermé.
						{/if}
					</span>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					{#if push === 'on'}
						<button type="button" class="btn-ghost" onclick={disablePush}>Désactiver</button>
						<form method="post" action="?/testPush" use:enhance>
							<button class="btn-ghost">Envoyer un test</button>
						</form>
					{:else if push === 'off' || push === 'busy'}
						<button type="button" class="btn-ink" disabled={push === 'busy'} onclick={enablePush}
							>Activer les notifications</button
						>
					{/if}
					{#if pushError}<p role="alert" class="text-sm text-danger">{pushError}</p>{/if}
					{#if form?.pushTestSent}<p role="status" class="text-sm text-success">
							Envoyée, elle arrive dans quelques secondes.
						</p>{/if}
				</div>
				{#if data.notifications.devices > 0}
					<p class="text-[13px] text-muted">
						{data.notifications.devices}
						{data.notifications.devices === 1 ? 'appareil reçoit' : 'appareils reçoivent'} les notifications.
					</p>
				{/if}
			</div>
		{/if}
	</section>

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
