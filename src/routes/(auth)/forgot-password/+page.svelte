<script lang="ts">
	import { resolve } from '$app/paths';
	import { authClient } from '#lib/auth-client.ts';
	import { authErrorMessage } from '#lib/auth-errors.ts';

	let sent = $state(false);
	let error = $state('');
	let pending = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const form = new FormData(event.currentTarget as HTMLFormElement);
		pending = true;
		const { error: err } = await authClient.requestPasswordReset({
			email: String(form.get('email')),
			// Absolute path: Better Auth checks it against the app origin
			redirectTo: '/reset-password'
		});
		pending = false;
		if (err) error = authErrorMessage(err.code);
		else sent = true;
	}
</script>

<svelte:head><title>Mot de passe oublié · Vulu</title></svelte:head>

<h1 class="font-display text-[40px] leading-tight font-extrabold tracking-tight">
	Mot de passe oublié
</h1>

{#if sent}
	<p role="status" class="text-sm">
		Si un compte existe avec cette adresse, un e-mail vient de partir avec un lien pour choisir un
		nouveau mot de passe. Il est valable une heure.
	</p>
{:else}
	<p class="text-sm text-muted">
		Indique l’adresse de ton compte : on t’envoie un lien pour choisir un nouveau mot de passe.
	</p>
	<form class="flex flex-col gap-3.5" onsubmit={submit}>
		<label class="flex flex-col gap-1.5 text-sm font-medium">
			E-mail
			<input name="email" type="email" autocomplete="email" required class="field" />
		</label>
		{#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
		<button type="submit" disabled={pending} class="mt-1 btn-accent">Envoyer le lien</button>
	</form>
{/if}

<p class="text-center text-sm text-muted">
	<a href={resolve('login')} class="font-semibold">Retour à la connexion</a>
</p>
