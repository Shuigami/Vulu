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

<h1 class="mb-1 text-xl font-semibold">Inscription</h1>
<p class="mb-4 text-sm text-gray-600">Vulu est en bêta : l’inscription demande une invitation.</p>

<form class="flex flex-col gap-3" onsubmit={submit}>
	<label class="flex flex-col gap-1 text-sm">
		E-mail invité
		<input
			name="email"
			type="email"
			autocomplete="email"
			required
			class="rounded border px-3 py-2"
		/>
	</label>
	<label class="flex flex-col gap-1 text-sm">
		Pseudo
		<input
			name="username"
			autocomplete="username"
			required
			minlength="3"
			maxlength="30"
			pattern="[a-zA-Z0-9_]+"
			title="Lettres, chiffres ou tiret bas (_)"
			class="rounded border px-3 py-2"
		/>
	</label>
	<label class="flex flex-col gap-1 text-sm">
		Nom affiché (facultatif)
		<input name="displayName" autocomplete="name" class="rounded border px-3 py-2" />
	</label>
	<label class="flex flex-col gap-1 text-sm">
		Mot de passe (8 caractères minimum)
		<input
			name="password"
			type="password"
			autocomplete="new-password"
			required
			minlength="8"
			class="rounded border px-3 py-2"
		/>
	</label>
	{#if error}<p role="alert" class="text-sm text-red-600">{error}</p>{/if}
	<button
		type="submit"
		disabled={pending}
		class="rounded bg-gray-900 px-3 py-2 text-white disabled:opacity-50"
	>
		Créer mon compte
	</button>
</form>

<SocialButtons providers={data.socialProviders} redirectTo="/" />

<p class="mt-6 text-center text-sm">
	Déjà inscrit ? <a href={resolve('login')} class="underline">Se connecter</a>
</p>
