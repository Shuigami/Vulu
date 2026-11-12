# Vulu — stack technique et schéma de données (V1)

Nov 8, 2026 · @shui

Proposition pour une première version développée seul, hébergée sur un petit VPS partagé avec d'autres projets (netcup VPS 500, 2 vCPU et 4 Go ; le Hetzner CX23 prévu au départ était en rupture de stock). Objectif : peu de briques, peu de RAM, et un schéma qui tienne quand on ajoutera le social et le freemium.

## Stack retenue

| Besoin | Choix | Pourquoi |
| --- | --- | --- |
| Front + back | **SvelteKit** (TypeScript) | Une seule base de code : pages rendues côté serveur, routes d'API et webhooks au même endroit. Léger et rapide à prendre en main. Alternative : Next.js si tu connais déjà React. |
| Base de données | **PostgreSQL 16** | Recherche floue intégrée (pg\_trgm, unaccent), JSONB pour les champs propres à chaque média, robuste. |
| Accès aux données | **Drizzle ORM** | Proche du SQL, typé, migrations versionnées. |
| Authentification | **Better Auth** | E-mail + mot de passe et OAuth (Google, GitHub), sessions en base. Génère ses propres tables. |
| Tâches de fond | **pg-boss** | File de tâches stockée dans PostgreSQL : pas de Redis à faire tourner en V1, donc moins de RAM sur un VPS partagé. |
| Recherche | **pg\_trgm + unaccent** | « soso no furiren » trouve « Sōsō no Furīren ». Testé : l'index est bien utilisé. Meilisearch seulement si le catalogue explose. |
| UI | **Tailwind CSS** + composants maison | Rapide à itérer, pas de dépendance lourde. |
| Images | **CDN des fournisseurs** (TMDB, AniList, Open Library) | Pas de ré-hébergement : zéro stockage, et c'est ce que prévoient les conditions d'utilisation (avec attribution). |
| Déploiement | **Docker Compose + Caddy** | HTTPS automatique ; quatre conteneurs : caddy, app, worker, postgres. |
| CI/CD | **GitHub Actions → GHCR** | Build de l'image à chaque tag, puis `docker compose pull && up -d` sur le VPS. |
| Sauvegardes | **pg\_dump nocturne + restic** | Vers un stockage objet (Cloudflare R2). |
| Mobile | **PWA** | Installable sur téléphone sans app native en V1. |

## Architecture

1. Le navigateur passe par **Caddy** (HTTPS) qui transmet à l'**app SvelteKit**.
2. L'app sert les pages, l'API interne (`/api/…`) et les webhooks (`/hooks/jellyfin/:token`). Elle lit et écrit dans **PostgreSQL**.
3. Le **worker** (même code, autre point d'entrée) dépile les tâches pg-boss : synchro du catalogue, imports, calendrier.
4. Seul le worker appelle **TMDB, AniList et Open Library**, avec un limiteur de débit par fournisseur (AniList : environ 90 requêtes/min). Les clés d'API ne quittent jamais le serveur.
5. Tâches planifiées : rafraîchissement quotidien des œuvres « en cours de diffusion », mise à jour hebdomadaire de l'export Open Library, purge des imports terminés.

### Alimentation du catalogue

- **Recherche** : on cherche d'abord dans la base locale ; s'il y a peu de résultats, on interroge en parallèle le fournisseur adapté au type (TMDB pour films/séries, AniList pour anime/manga, Open Library pour les livres) et on fusionne.
- **Ajout** : quand un utilisateur ajoute une œuvre, on l'enregistre (`media` + identifiants externes + titres alternatifs), puis une tâche récupère saisons et épisodes.
- **Source de vérité par type** : TMDB pour films et séries, AniList pour anime et manga, Open Library pour les livres. Un anime garde aussi son identifiant TMDB et MAL dans `media_external_ids`, ce qui permet d'importer depuis Trakt ou MAL sans doublons.

## Schéma de base de données

Le SQL complet est fourni dans `schema.sql` (chargé et testé sur PostgreSQL 16). Vue d'ensemble :

### Catalogue

| Table | Rôle |
| --- | --- |
| `media` | Une ligne par œuvre, tous types confondus (`type` : movie, tv, anime, manga, book). Titre, statut de diffusion, dates, affiche, nombre total d'unités (épisodes, chapitres ou pages) et unité secondaire (saisons ou volumes). Les champs propres à un type (auteurs, studio…) vont dans `extra` en JSONB. |
| `media_external_ids` | Identifiants chez les fournisseurs (`tmdb`, `anilist`, `mal`, `openlibrary`, `isbn13`…). Clé primaire (fournisseur, identifiant) : impossible de créer deux fois la même œuvre. Un seul identifiant « primaire » par œuvre pour la synchro. |
| `media_titles` | Titres alternatifs (romaji, japonais, anglais, français), indexés pour la recherche floue sans accents. |
| `genres`, `media_genres` | Genres normalisés. |
| `seasons`, `episodes` | Pour séries et anime : numéro, numérotation absolue (anime), date de diffusion. Alimente le calendrier et le suivi épisode par épisode. |

### Données utilisateur

| Table | Rôle |
| --- | --- |
| `users` | Profil, langue, échelle de notation préférée (/5, /10, /100), visibilité du profil, colonne `plan` prête pour le freemium. |
| `library_entries` | Le cœur de l'app : une ligne par (utilisateur, œuvre). Statut (à voir, en cours, terminé, en pause, abandonné), note sur 100, progression principale et secondaire, nombre de revisionnages, dates, critique, notes privées, favori. |
| `episode_views` | Épisodes vus un par un, pour ceux qui sautent des épisodes ou revoient une saison. Optionnel côté interface en V1. |
| `activity_events` | Journal de tout ce qui se passe (+1 épisode, +40 pages, terminé, noté…) avec sa source (manuel, Jellyfin, import). Alimente l'historique, les statistiques et la rétrospective annuelle. `dedup_key` empêche qu'un webhook reçu deux fois compte double. |
| `lists`, `list_items` | Listes personnalisées, ordonnées ou non, privées ou publiques. |
| `integrations` | Connexions Jellyfin, Plex, AniList, MAL, Trakt : jeton de webhook, identifiants OAuth chiffrés, dernière synchro. |
| `import_jobs` | Suivi des imports (Trakt, AniList, MAL, Goodreads, StoryGraph, TV Time, Letterboxd, CSV) avec les lignes non rattachées, à corriger à la main. |

### Choix de conception

- **Une table `media` unique** plutôt qu'une table par type : la bibliothèque, les listes et les stats restent de simples requêtes, et ajouter un type plus tard (jeux, BD) revient à ajouter une valeur à l'enum.
- **Progression générique** : `progress` vaut des épisodes, des chapitres ou des pages selon le type ; `progress_secondary` vaut des saisons ou des volumes. L'interface choisit les libellés.
- **Note stockée sur 100** et affichée dans l'échelle de l'utilisateur : imports MAL (/10) et AniList (/100) sans perte.
- **Compteur + journal** : `library_entries` donne l'état courant (lecture rapide), `activity_events` garde l'historique (statistiques). On n'a jamais à recalculer l'état à partir du journal.
- **Catalogue partagé, pas de copie par utilisateur** : une œuvre ajoutée par quelqu'un profite à tous, ce qui réduit les appels aux API.
- **`ON DELETE RESTRICT`** entre bibliothèque et catalogue : on ne peut pas supprimer une œuvre suivie par quelqu'un par accident.

## Périmètre de la V1

- Inscription et connexion (e-mail, Google ou GitHub).
- Recherche et ajout pour les cinq types de médias.
- Bibliothèque : statut, progression, note, dates, filtres par type et par statut.
- Page « En cours » : tout ce que tu suis, avec bouton +1.
- Calendrier des prochains épisodes des séries et anime suivis.
- Imports : AniList, MAL (export XML), Goodreads (CSV), Trakt.
- Webhook Jellyfin pour cocher automatiquement ce que tu regardes.
- Statistiques simples (temps total, œuvres terminées par mois et par type).
- Export complet JSON et CSV : un argument fort après la fermeture de TV Time.

**Plus tard (V2 et au-delà)** : profils et listes publics, abonnements entre utilisateurs, critiques publiques, Plex, notifications de sortie, rétrospective annuelle, abonnement payant.

## Ordre de développement suggéré

1. Squelette SvelteKit + Drizzle + PostgreSQL en local, migrations depuis `schema.sql`.
2. Authentification.
3. Clients TMDB, AniList et Open Library dans le worker, avec limiteur de débit et cache.
4. Recherche et ajout, puis la bibliothèque.
5. Synchro des épisodes et calendrier.
6. Imports (AniList et Goodreads d'abord, les plus simples).
7. Webhook Jellyfin, testé sur ton propre serveur.
8. Dockerisation, déploiement sur le VPS, sauvegardes.

## Points à trancher

- **Framework** : SvelteKit par défaut, Next.js si tu préfères rester sur React.
- **Ouverture du code** : open source dès le début (pratique pour le modèle « auto-hébergeable + version hébergée payante ») ou privé pour l'instant.
- **Inscriptions** : ouvertes à tous (e-mail, Google ou GitHub). Le site se consulte sans compte ; il est demandé pour ajouter une œuvre ou toute autre action personnelle.
