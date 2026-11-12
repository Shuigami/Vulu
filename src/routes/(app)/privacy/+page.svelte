<script lang="ts">
	import { resolve } from '$app/paths';

	const contact = 'vulu@shuii.net';
</script>

<svelte:head><title>Confidentialité · Vulu</title></svelte:head>

<article
	class="flex max-w-2xl flex-col gap-4 leading-relaxed [&_h2]:mt-4 [&_ul]:list-disc [&_ul]:pl-5"
>
	<h1 class="font-display text-[40px] font-extrabold tracking-tight">Confidentialité</h1>
	<p class="text-muted">Dernière mise à jour : 12 novembre 2026</p>

	<p>
		Vulu est un projet personnel, non commercial, pour suivre ses films, séries, animés, mangas et
		livres. Cette page explique quelles données il garde et pourquoi.
	</p>

	<h2 class="h2">Données conservées</h2>
	<ul>
		<li>
			Ton compte : adresse e-mail, pseudo, nom affiché, photo de profil et mot de passe (stocké
			chiffré, jamais en clair).
		</li>
		<li>
			Avec la connexion Google : ton nom, ton adresse e-mail et l’adresse de ta photo de profil
			Google. Vulu n’a accès à rien d’autre sur ton compte Google.
		</li>
		<li>
			Ce que tu enregistres : bibliothèque, progression, notes, avis, listes, abonnements et
			l’historique de ces actions.
		</li>
		<li>
			Les intégrations et imports que tu configures (par exemple le webhook Jellyfin ou un pseudo
			AniList).
		</li>
	</ul>

	<h2 class="h2">Utilisation</h2>
	<p>
		Ces données servent uniquement à faire fonctionner Vulu : ta bibliothèque, tes statistiques, ton
		profil et les recommandations. Il n’y a ni publicité, ni outil de mesure d’audience, ni revente
		de données. Le seul e-mail envoyé est celui de réinitialisation du mot de passe.
	</p>

	<h2 class="h2">Ce qui est visible</h2>
	<p>
		Ton profil est public par défaut : pseudo, photo, œuvres suivies, notes et activité. Tu peux le
		rendre privé dans les <a href={resolve('settings')}>paramètres</a>, ou masquer une œuvre précise
		depuis sa fiche. Une liste n’est visible que si tu la rends publique.
	</p>

	<h2 class="h2">Cookies</h2>
	<p>
		Vulu utilise un cookie de session pour te garder connecté et un cookie pour le thème clair ou
		sombre. Aucun cookie publicitaire ou de suivi.
	</p>

	<h2 class="h2">Services tiers</h2>
	<ul>
		<li>Hébergement : netcup (serveur en Allemagne).</li>
		<li>Sauvegardes chiffrées : Cloudflare R2.</li>
		<li>Envoi d’e-mails : Brevo.</li>
		<li>Connexion : Google, seulement si tu l’utilises.</li>
		<li>
			Affiches et informations des œuvres : TMDB, AniList et Open Library. Les images sont chargées
			directement depuis leurs serveurs, qui voient donc ton adresse IP.
		</li>
	</ul>

	<h2 class="h2">Conservation et droits</h2>
	<p>
		Les données sont gardées tant que ton compte existe. Tu peux exporter toutes tes données depuis
		les paramètres. Pour accéder à tes données, les corriger ou supprimer ton compte, écris à
		<a href="mailto:{contact}">{contact}</a> ; la suppression efface toutes tes données, et elles disparaissent
		des sauvegardes en six mois au plus.
	</p>
</article>
