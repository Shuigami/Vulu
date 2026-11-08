<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '#lib/auth-client.ts';
	import { authErrorMessage } from '#lib/auth-errors.ts';
	import SocialButtons from '#lib/components/SocialButtons.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let error = $state('');
	let pending = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const form = new FormData(event.currentTarget as HTMLFormElement);
		const username = String(form.get('username'));
		const displayName = String(form.get('displayName')).trim();
		pending = true;
		const { error: err } = await authClient.signUp.email({
			email: String(form.get('email')),
			password: String(form.get('password')),
			name: displayName || username,
			username
		});
		pending = false;
		if (err) {
			error = authErrorMessage(err.code);
			return;
		}
		await invalidateAll();
		await goto(resolve(''));
	}
</script>

<svelte:head><title>Inscription · Vulu</title></svelte:head>

<h1 class="font-display text-[40px] font-extrabold tracking-tight">Inscription</h1>
<p class="-mt-4 text-muted">Vulu est en bêta : l’inscription demande une invitation.</p>

<form class="flex flex-col gap-3.5" onsubmit={submit}>
	<label class="flex flex-col gap-1.5 text-sm font-medium">
		E-mail invité
		<input name="email" type="email" autocomplete="email" required class="field" />
	</label>
	<label class="flex flex-col gap-1.5 text-sm font-medium">
		Pseudo
		<input
			name="username"
			autocomplete="username"
			required
			minlength="3"
			maxlength="30"
			pattern="[a-zA-Z0-9_]+"
			title="Lettres, chiffres ou tiret bas (_)"
			class="field"
		/>
	</label>
	<label class="flex flex-col gap-1.5 text-sm font-medium">
		Nom affiché (facultatif)
		<input name="displayName" autocomplete="name" class="field" />
	</label>
	<label class="flex flex-col gap-1.5 text-sm font-medium">
		Mot de passe (8 caractères minimum)
		<input
			name="password"
			type="password"
			autocomplete="new-password"
			required
			minlength="8"
			class="field"
		/>
	</label>
	{#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
	<button type="submit" disabled={pending} class="mt-1 btn-accent"> Créer mon compte </button>
</form>

<SocialButtons providers={data.socialProviders} redirectTo="/" />

<p class="text-center text-sm text-muted">
	Déjà inscrit ? <a href={resolve('login')} class="font-semibold">Se connecter</a>
</p>
