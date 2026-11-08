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
pnpm db:seed              # données de démonstration (facultatif)
pnpm invite toi@exemple.fr # l'inscription est sur invitation pendant la bêta
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
