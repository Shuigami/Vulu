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
src/env.ts               app environment variables, validated at startup ($app/env/private)
src/hooks.server.ts      session -> locals.user / locals.session, serves /api/auth/*
src/lib/server/db/       schema.ts (Drizzle), index.ts (createDb)
src/lib/server/auth/     createAuth (Better Auth on the users table, usernames)
src/lib/server/app.ts    app-only singletons: db, auth (reads $app/env/private)
src/lib/server/providers/ TMDB, AniList, Open Library clients (rate limiter, retries in http.ts, cache.ts)
src/lib/server/catalogue.ts provider per media type, cached search, import/upsert into the catalogue
src/lib/server/jobs.ts   pg-boss queue names, payload types, requestJob (send and wait for the output)
src/lib/server/          other server-only code shared by the app and the worker
src/lib/auth-client.ts   Better Auth browser client; auth-errors.ts maps error codes to French
src/lib/server/library.ts library entries: add, update (applyChange rules + activity_events), list
src/lib/server/search.ts local fuzzy search, then providers through the worker
src/lib/server/calendar.ts upcoming episodes, Paris-time formatting (server-side)
src/lib/server/social.ts follows, profiles, activity feed, community ratings (visibility rule)
src/lib/server/stats.ts  stats page: time, units and completions per month from activity_events
src/lib/server/export.ts full JSON/CSV export (/settings/export.json|csv)
src/lib/server/lists.ts  custom lists: CRUD, owner checks, visibility (public list + non-private profile)
src/lib/server/profile.ts display name, avatars (bytes in `avatars`, served by src/routes/avatars/[id])
src/lib/server/mail.ts   SMTP via nodemailer (SMTP_URL, MAIL_FROM); without SMTP_URL, prints to console
src/lib/server/discover.ts home page: provider trending and recommendations, popular on Vulu
src/lib/server/imports/  library imports: Goodreads, MAL, Letterboxd parsers, runImport (match, add, journal)
src/lib/server/jellyfin.ts webhook payload parsing and the template to paste in Jellyfin
src/lib/server/scrobble.ts watched events -> library progress (worker side)
src/routes/hooks/        webhooks, no session: /hooks/jellyfin/[token]
src/lib/labels.ts        French labels for enums, score scale conversions (shared client/server)
src/routes/(app)/        pages; browsing is public, personal pages and actions call requireUser (server/guard.ts): / (Accueil, +1),
                         /search, /media/[id], /library, /lists, /lists/[id], /calendar,
                         /stats, /import, /integrations, /activity, /u/[username], /settings
static/                  PWA manifest and icons (PNGs drawn from static/icons/icon.svg)
src/routes/(auth)/       /login, /signup, /forgot-password, /reset-password
src/worker/index.ts      worker entry point (pg-boss); only the worker calls external APIs
.github/workflows/ci.yml lint, types, migrations on an empty database, schema drift check, tests
.github/workflows/release.yml image to ghcr.io/shuigami/vulu on every v* tag
Dockerfile, docker-compose.yml, Caddyfile  production: caddy, app, worker, postgres, one-shot migrate
src/lib/server/db/migrate.ts migrations without drizzle-kit (production)
scripts/backup.sh        nightly pg_dump into restic (host cron)
```

## Production

- One image runs the app (`node build`), the worker and `migrate.ts` (`node --import tsx …`, so `tsx` is a runtime dependency). The build validates `src/env.ts`, hence the placeholder values in the Dockerfile; real values are read at runtime.
- The compose project is `vulu-prod`, not `vulu`, which is the dev database's project.
- The app sets `ORIGIN`, `BETTER_AUTH_URL` and `DATABASE_URL` from `VULU_DOMAIN` and `POSTGRES_PASSWORD`. `BODY_SIZE_LIMIT` must stay above the 5 MB import cap.
- Deployed at https://vulu.shuii.net on a netcup VPS (Debian 13, 4 GB) shared with other projects: SSH as `shui` (key only), stack in `/srv/vulu`, shared Caddy in `/srv/proxy` (`deploy/proxy/`, the bundled caddy is disabled by `docker-compose.override.yml`). Release: push a `v*` tag, then `docker compose pull && docker compose up -d` in `/srv/vulu`.
- netcup blocks outbound 25/465/587: mail goes through Brevo on port 2525. Nightly restic backup to Cloudflare R2 (shui's crontab, 03:30 UTC, log in `/srv/vulu/backup.log`).

## Conventions

- Code, identifiers, comments and commit messages in English. The UI is in French; keep user-facing strings easy to extract for i18n later.
- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`), small and focused commits. Work on a branch, never directly on `main`.
- Never commit secrets or API keys. `.env` is git-ignored; document new variables in `.env.example`.
- Shared server code must not import `$app/*` or other SvelteKit-only modules, and uses relative imports, so the worker (run with tsx) can load it. Pass config (e.g. the database URL) in as arguments. Only `src/lib/server/app.ts` and SvelteKit files read `$app/env/private`.
- SvelteKit 3: environment variables are declared in `src/env.ts`; `resolve()` from `$app/paths` takes paths without a leading slash (`resolve('login')`).
- Auth: Better Auth uses the `users` table (`name` -> `display_name`, `image` -> `avatar_url`) and `sessions`, `accounts`, `verifications`. Sign-up is open (password, Google or GitHub; the `invites` table is unused). Signing in with Google (or GitHub with a verified e-mail) on an existing password account links it and drops the password and sessions (local e-mails are unverified: `accountLinking` + account hook); the username is chosen at password sign-up and derived from the e-mail for OAuth. Only password reset sends e-mails (one-hour link, other sessions revoked); no e-mail verification yet. Browsing needs no account: public loads use `viewerId(locals)` (signed-out = `ANONYMOUS_ID`, sees only public data), personal pages and every action call `requireUser(locals, url)`, which redirects to `/login?redirectTo=`.
- Database changes: edit `schema.ts`, run `pnpm db:generate`, commit the generated migration. Things drizzle-kit cannot express (extensions, functions, triggers) go in a custom migration: `pnpm drizzle-kit generate --custom --name <name>`. Keep `docs/schema.sql` in sync when the schema changes.
- Drizzle uses `casing: 'snake_case'`: camelCase in TypeScript, snake_case in SQL.
- Fuzzy search compares `f_unaccent(lower(title))` so queries hit `media_titles_trgm_idx`.
- Providers: only the worker calls them. The app gets provider results with `requestJob(boss, QUEUES.search, …)`. Responses are cached in `provider_cache` (1 day, purged daily). Clients take `fetch` and `limiter` options so tests use fake responses, never the network. Imports match on the primary external id (`upsertMedia`); the source of truth per type is TMDB (movie, tv), AniList (anime, manga), Open Library (book).
- Library changes go through `updateEntry`, which applies the automatic rules (`applyChange`: progress caps, status follows progress, dates) and writes `activity_events` in the same transaction. Never update `library_entries` directly.
- Search: local results first; providers are queried (all types in parallel) only below `LOCAL_ENOUGH` results, and streamed to the page. Adult media are hidden. TMDB drops Japanese animated series (AniList owns anime).
- Episodes: after a TV/anime import the worker queues `media-episodes` (TMDB: all seasons; AniList: upcoming schedule only, future episodes that leave it are deleted). `airing-refresh` (daily 03:00 UTC) re-imports airing media followed by someone, bypassing the cache. TMDB air dates are stored at 00:00 UTC and shown without a time.
- Imports (`library-import` job): AniList by public username (the worker fetches the lists, media come embedded, no per-title call); Goodreads CSV parsed in the app, books matched on Open Library by ISBN then title/author (1 request per book); MyAnimeList XML (.xml or .xml.gz, parsed in the app, capped at 50 MB decompressed) matched through AniList by MAL id, 50 per request; Letterboxd export (ZIP or its CSV files, parsed in the app, own small ZIP reader) matched on TMDB by title and year (±1); Trakt by public username (`TRAKT_CLIENT_ID`), or for private profiles by OAuth sign-in (PKCE, no secret; redirect URI `<origin>/import/trakt`, state and verifier in a cookie; the worker trades the code for a token, imports `/users/me`, then revokes it, nothing stored), TMDB ids imported from TMDB. A finished work whose every unit was seen is imported as completed. Existing library entries are never changed; journal events use dedup keys `import:<source>:<mediaId>:<kind>` so a replay adds nothing. Unmatched rows are stored in `import_jobs.unmatched`. One running import per user.
- Jellyfin: plugin "Webhook", Generic destination, with the template from `jellyfin.ts` (every value a quoted string). The endpoint checks the token, keeps finished plays (`PlayedToCompletion`, or 90 % of runtime) and "marked as played", queues `jellyfin-event` and answers 202. Episodes carry no series provider id: the worker matches `SeriesName` in the user's library, then the catalogue (similarity ≥ 0.9), then providers (exact title). Progress only moves forward; `updateEntry(..., { source, dedupKey })` makes deliveries idempotent per item and day. The last 20 events are kept in `integrations.settings.recent`.
- Social: follows need no approval. Profiles are public by default; a `private` profile and entries with `is_private` are only visible to their owner (`visibleTo` in `social.ts`, use it in every query that shows someone else's data). Feeds show `started`, `completed` and `rated` events, never `source = 'import'`.
- Home page discovery: trending and recommendations go through the `provider-discover` job (cached 1 day) and are streamed; provider suggestions not yet in the catalogue are opened with `search?/open` (import without adding).
- Dates are formatted on the server in `Europe/Paris` (`calendar.ts`), so pages do not depend on the browser timezone.
- Scores are stored out of 100; progress is generic (`progress` = episodes/chapters/pages, `progress_secondary` = seasons/volumes).
- Images are hot-linked from provider CDNs, never re-hosted. Only avatars are stored: cropped to 256 px in the browser, at most 300 KB, type checked from the bytes, kept in the `avatars` table (backed up by pg_dump).
- RAM matters (shared small VPS): avoid adding services or heavy dependencies without asking.
