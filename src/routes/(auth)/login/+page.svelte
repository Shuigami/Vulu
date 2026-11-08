<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { authClient } from '#lib/auth-client.ts';
	import { authErrorMessage } from '#lib/auth-errors.ts';
	import SocialButtons from '#lib/components/SocialButtons.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Only same-site paths, to avoid an open redirect.
	const target = page.url.searchParams.get('redirectTo') ?? '/';
	const redirectTo = target.startsWith('/') && !target.startsWith('//') ? target : '/';

	const oauthError = page.url.searchParams.get('error');
	let error = $state(oauthError ? authErrorMessage(oauthError) : '');
	let pending = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const form = new FormData(event.currentTarget as HTMLFormElement);
		pending = true;
		const { error: err } = await authClient.signIn.email({
			email: String(form.get('email')),
			password: String(form.get('password'))
		});
		pending = false;
		if (err) {
			error = authErrorMessage(err.code);
			return;
		}
		await invalidateAll();
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- validated same-site path from ?redirectTo
		await goto(redirectTo);
	}
</script>

<svelte:head><title>Connexion · Vulu</title></svelte:head>

<h1 class="font-display text-[40px] font-extrabold tracking-tight">Connexion</h1>

<form class="flex flex-col gap-3.5" onsubmit={submit}>
	<label class="flex flex-col gap-1.5 text-sm font-medium">
		E-mail
		<input name="email" type="email" autocomplete="email" required class="field" />
	</label>
	<label class="flex flex-col gap-1.5 text-sm font-medium">
		Mot de passe
		<input name="password" type="password" autocomplete="current-password" required class="field" />
	</label>
	{#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
	<button type="submit" disabled={pending} class="mt-1 btn-accent"> Se connecter </button>
</form>

<SocialButtons providers={data.socialProviders} {redirectTo} />

<p class="text-center text-sm text-muted">
	Pas encore de compte ? <a href={resolve('signup')} class="font-semibold">S’inscrire</a>
</p>
