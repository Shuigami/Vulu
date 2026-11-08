# Vulu

Web app to track movies, TV shows, anime, manga and books in a single library: search a title, add it, track progress (episodes, chapters, pages), rate it, see upcoming releases. Metadata comes from TMDB (movies/TV), AniList (anime/manga) and Open Library (books).

**Read `docs/` first.** `docs/v1-spec.md` (stack, architecture, V1 scope, development order) and `docs/schema.sql` (validated PostgreSQL schema) are the source of truth. Both are in French. Do not change the stack without asking.

## Stack

SvelteKit 3 + TypeScript (strict, adapter-node), PostgreSQL 16, Drizzle ORM (node-postgres driver), Better Auth, pg-boss (no Redis), Tailwind CSS 4, search with pg_trgm + unaccent, Vitest. Package manager: pnpm. Node >= 24.

## Commands

| Command            | What it does                                                       |
| ------------------ | ------------------------------------------------------------------ |
| `pnpm db:up`       | Start PostgreSQL 16 in Docker (`docker-compose.dev.yml`)           |
| `pnpm db:migrate`  | Apply migrations in `drizzle/`                                     |
| `pnpm db:generate` | Generate a migration from changes in `src/lib/server/db/schema.ts` |
| `pnpm db:seed`     | Insert demo data (idempotent)                                      |
| `pnpm dev`         | SvelteKit dev server                                               |
| `pnpm worker:dev`  | Worker (pg-boss) in watch mode                                     |
| `pnpm lint`        | Prettier check + ESLint                                            |
| `pnpm check`       | svelte-check (types)                                               |
| `pnpm test`        | Vitest, once. Needs a migrated database (`db:up` + `db:migrate`)   |
| `pnpm format`      | Prettier write                                                     |

Before finishing a task: `pnpm lint && pnpm check && pnpm test` must pass.

## Layout

```
docs/                    spec and reference schema (source of truth, French)
drizzle/                 SQL migrations (0000 and 0002 are hand-written), meta/ is generated
src/lib/server/db/       schema.ts (Drizzle), index.ts (createDb), seed.ts
src/lib/server/          server-only code shared by the app and the worker
src/routes/              SvelteKit pages, /api/… and /hooks/… endpoints
src/worker/index.ts      worker entry point (pg-boss); only the worker calls external APIs
.github/workflows/ci.yml lint, types, migrations on an empty database, schema drift check, tests
```

## Conventions

- Code, identifiers, comments and commit messages in English. The UI is in French; keep user-facing strings easy to extract for i18n later.
- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`), small and focused commits. Work on a branch, never directly on `main`.
- Never commit secrets or API keys. `.env` is git-ignored; document new variables in `.env.example`.
- Shared server code must not import `$env/*` or other SvelteKit-only modules, and uses relative imports, so the worker (run with tsx) can load it. Pass config (e.g. the database URL) in as arguments.
- Database changes: edit `schema.ts`, run `pnpm db:generate`, commit the generated migration. Things drizzle-kit cannot express (extensions, functions, triggers) go in a custom migration: `pnpm drizzle-kit generate --custom --name <name>`. Keep `docs/schema.sql` in sync when the schema changes.
- Drizzle uses `casing: 'snake_case'`: camelCase in TypeScript, snake_case in SQL.
- Fuzzy search compares `f_unaccent(lower(title))` so queries hit `media_titles_trgm_idx`.
- Scores are stored out of 100; progress is generic (`progress` = episodes/chapters/pages, `progress_secondary` = seasons/volumes).
- Images are hot-linked from provider CDNs, never re-hosted.
- RAM matters (shared small VPS): avoid adding services or heavy dependencies without asking.
