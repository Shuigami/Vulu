<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { authClient } from '#lib/auth-client.ts';
	import { authErrorMessage } from '#lib/auth-errors.ts';

	// Better Auth redirects here with ?token=… or ?error=INVALID_TOKEN
	const token = page.url.searchParams.get('token');
	const linkError = page.url.searchParams.get('error');
	let error = $state('');
	let pending = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const form = new FormData(event.currentTarget as HTMLFormElement);
		const newPassword = String(form.get('password'));
		if (newPassword !== form.get('confirm')) {
			error = 'Les deux mots de passe ne correspondent pas.';
			return;
		}
		pending = true;
		const { error: err } = await authClient.resetPassword({ newPassword, token: token! });
		pending = false;
		if (err) {
			error = authErrorMessage(err.code);
			return;
		}
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- query on a resolved path
		await goto(`${resolve('login')}?reset=1`);
	}
</script>

<svelte:head><title>Nouveau mot de passe · Vulu</title></svelte:head>

<h1 class="font-display text-[40px] leading-tight font-extrabold tracking-tight">
	Nouveau mot de passe
</h1>

{#if !token || linkError}
	<p role="alert" class="text-sm text-danger">
		Ce lien n’est plus valable : il a peut-être expiré ou déjà servi.
	</p>
	<p class="text-center text-sm">
		<a href={resolve('forgot-password')} class="font-semibold">Demander un nouveau lien</a>
	</p>
{:else}
	<form class="flex flex-col gap-3.5" onsubmit={submit}>
		<label class="flex flex-col gap-1.5 text-sm font-medium">
			Nouveau mot de passe
			<input
				name="password"
				type="password"
				autocomplete="new-password"
				minlength="8"
				required
				class="field"
			/>
		</label>
		<label class="flex flex-col gap-1.5 text-sm font-medium">
			Confirmer
			<input
				name="confirm"
				type="password"
				autocomplete="new-password"
				minlength="8"
				required
				class="field"
			/>
		</label>
		{#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
		<button type="submit" disabled={pending} class="mt-1 btn-accent">Changer le mot de passe</button
		>
	</form>
	<p class="text-center text-[13px] text-muted">Tes autres sessions seront déconnectées.</p>
{/if}
