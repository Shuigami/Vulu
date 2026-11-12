# Vulu

Suivi de visionnage et de lecture : films, séries, anime, mangas et livres dans une seule bibliothèque.

Spécification et schéma de données : [`docs/`](docs/).

## Prérequis

- Node.js 24 ou plus
- pnpm (`corepack enable pnpm` ou `npm i -g pnpm`)
- Docker (pour PostgreSQL)

## Installation en local

```bash
pnpm install
cp .env.example .env      # puis remplir les clés si besoin
pnpm db:up                # PostgreSQL 16 dans Docker, port 5432
pnpm db:migrate           # crée les tables
```

Dans `.env`, `BETTER_AUTH_SECRET` doit faire au moins 32 caractères (`openssl rand -base64 32`). La connexion Google ou GitHub est facultative : renseigne les identifiants OAuth indiqués dans `.env.example` pour afficher les boutons correspondants.

Puis, dans deux terminaux :

```bash
pnpm dev                  # application sur http://localhost:5173
pnpm worker:dev           # worker pg-boss (tâches de fond)
```

Les données PostgreSQL sont conservées dans le volume Docker `vulu_pgdata`. Pour repartir d'une base vide :

```bash
docker compose -f docker-compose.dev.yml down -v
```

## Vérifications

```bash
pnpm lint     # Prettier + ESLint
pnpm check    # types
pnpm test     # tests (nécessite la base migrée)
```

La CI GitHub Actions lance les mêmes vérifications et applique les migrations sur une base vierge.

## Production

`docker-compose.yml` lance cinq conteneurs : `caddy` (HTTPS automatique), `app`, `worker`, `postgres`, et `migrate` qui applique les migrations puis s'arrête. L'app et le worker utilisent la même image, construite par `.github/workflows/release.yml` à chaque tag `v*` et publiée sur `ghcr.io/shuigami/vulu`.

### Installer sur le serveur

1. Installer Docker, ouvrir les ports 80 et 443, faire pointer le domaine vers le serveur.
2. Copier `docker-compose.yml`, `Caddyfile` et `scripts/backup.sh` dans `/srv/vulu`.
3. Créer `/srv/vulu/.env` à partir de `.env.example` : `VULU_DOMAIN`, `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `TMDB_API_KEY`, etc. (`DATABASE_URL` et `BETTER_AUTH_URL` sont fixés par le compose). Les URL de rappel OAuth deviennent `https://<domaine>/api/auth/callback/google` (ou `github`).
4. Si le paquet GHCR est privé : `docker login ghcr.io` avec un jeton `read:packages`.
5. Lancer :

```bash
docker compose pull && docker compose up -d
```

#### Serveur partagé avec d'autres projets

Un seul Caddy peut écouter sur les ports 80 et 443. Sur un serveur qui héberge plusieurs projets, le proxy commun vit dans `deploy/proxy/` (copié dans `/srv/proxy`, un bloc par site dans son `Caddyfile`) et Vulu n'utilise pas son propre Caddy :

```bash
cd /srv/proxy && docker compose up -d                                  # une fois, crée le réseau "proxy"
cp docker-compose.shared-proxy.yml /srv/vulu/docker-compose.override.yml # caddy de Vulu désactivé, app joignable en vulu-app
```

Les autres projets rejoignent le réseau externe `proxy` de la même façon, sous un alias unique. Aucun autre conteneur ne publie de port (Docker contourne le pare-feu pour les ports publiés).

Chez netcup, les ports sortants 25, 465 et 587 sont bloqués : utiliser le port 2525 du relais SMTP (`smtp://user:password@smtp-relay.brevo.com:2525`).

Mise à jour : pousser un tag (`git tag v0.2.0 && git push --tags`), attendre l'image, puis `docker compose pull && docker compose up -d` sur le serveur.

Pour essayer la pile en local : `docker build -t ghcr.io/shuigami/vulu:latest .`, puis `docker compose --env-file <fichier avec VULU_DOMAIN=localhost et POSTGRES_PASSWORD> up -d` (Caddy signe alors un certificat local). Le projet Compose s'appelle `vulu-prod` et ne touche pas à la base de développement.

### Sauvegardes

`scripts/backup.sh` envoie un `pg_dump` dans un dépôt [restic](https://restic.net) (en production : un bucket Cloudflare R2, via l'API S3), puis garde 7 sauvegardes quotidiennes, 4 hebdomadaires et 6 mensuelles. Il faut restic ≥ 0.17 sur le serveur et un fichier `/srv/vulu/.backup.env` (mode 600) :

```bash
RESTIC_REPOSITORY=s3:https://<account-id>.r2.cloudflarestorage.com/vulu-backups
RESTIC_PASSWORD_FILE=/srv/vulu/.restic-password
AWS_ACCESS_KEY_ID=...        # jeton R2 limité au bucket, Object Read & Write
AWS_SECRET_ACCESS_KEY=...
AWS_DEFAULT_REGION=auto
```

Garder une copie du mot de passe restic hors du serveur : sans lui, les sauvegardes sont illisibles. Initialiser le dépôt une fois (`restic init`), puis ajouter au cron de l'utilisateur qui gère Vulu (membre du groupe `docker`) :

```bash
30 3 * * * /srv/vulu/scripts/backup.sh >> /srv/vulu/backup.log 2>&1
```

Restaurer la dernière sauvegarde (écrase la base) :

```bash
docker compose stop app worker
restic dump --tag vulu latest /vulu.dump | docker compose exec -T postgres pg_restore -U vulu -d vulu --clean --if-exists
docker compose start worker app
```
