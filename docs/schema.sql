-- Vulu — schéma PostgreSQL de la V1
-- Films, séries, anime, mangas, livres dans un catalogue unique.
-- Les tables d'authentification (session, compte OAuth, vérification e-mail)
-- sont générées par la bibliothèque d'auth et ne figurent pas ici.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;

-- unaccent() n'est pas IMMUTABLE : wrapper pour pouvoir l'indexer
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
CREATE TYPE media_type     AS ENUM ('movie', 'tv', 'anime', 'manga', 'book');
CREATE TYPE release_status AS ENUM ('announced', 'releasing', 'finished', 'cancelled', 'hiatus');
CREATE TYPE provider       AS ENUM ('tmdb', 'imdb', 'tvdb', 'anilist', 'mal', 'mangaupdates',
                                    'openlibrary', 'isbn13', 'google_books', 'hardcover');
CREATE TYPE entry_status   AS ENUM ('planned', 'in_progress', 'completed', 'paused', 'dropped');
CREATE TYPE event_kind     AS ENUM ('episode', 'chapter', 'volume', 'pages', 'started',
                                    'completed', 'rated', 'status_changed');
CREATE TYPE event_source   AS ENUM ('manual', 'jellyfin', 'plex', 'import', 'api');
CREATE TYPE visibility     AS ENUM ('private', 'unlisted', 'public');
CREATE TYPE job_status     AS ENUM ('pending', 'running', 'done', 'failed');

-- ---------------------------------------------------------------------------
-- Utilisateurs
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  username      citext NOT NULL UNIQUE CHECK (username ~ '^[a-zA-Z0-9_]{3,30}$'),
  display_name  text,
  avatar_url    text,
  locale        text NOT NULL DEFAULT 'fr',
  rating_scale  smallint NOT NULL DEFAULT 10 CHECK (rating_scale IN (5, 10, 100)),
  profile_visibility visibility NOT NULL DEFAULT 'private',
  plan          text NOT NULL DEFAULT 'free',          -- prêt pour le freemium
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Catalogue (alimenté à la demande depuis TMDB / AniList / Open Library)
-- ---------------------------------------------------------------------------
CREATE TABLE media (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type               media_type NOT NULL,
  title              text NOT NULL,             -- titre d'affichage (locale par défaut)
  original_title     text,
  overview           text,
  status             release_status,
  start_date         date,
  end_date           date,
  poster_url         text,                      -- URL du CDN source, pas de réhébergement
  backdrop_url       text,
  runtime_minutes    integer,                   -- film, ou durée moyenne d'un épisode
  -- Unités de progression : épisodes (tv/anime), chapitres (manga), pages (livre)
  total_units        integer CHECK (total_units >= 0),
  -- Unité secondaire : volumes (manga), saisons (tv/anime)
  total_units_secondary integer CHECK (total_units_secondary >= 0),
  is_adult           boolean NOT NULL DEFAULT false,
  extra              jsonb NOT NULL DEFAULT '{}'::jsonb,   -- champs propres à un type (auteurs, studio, ISBN10…)
  last_synced_at     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_type_idx        ON media (type);
CREATE INDEX media_sync_queue_idx  ON media (last_synced_at) WHERE status IN ('releasing', 'announced');

-- Identifiants chez les fournisseurs : dédoublonnage et correspondances TMDB <-> AniList <-> MAL
CREATE TABLE media_external_ids (
  media_id     bigint NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  provider     provider NOT NULL,
  external_id  text NOT NULL,
  is_primary   boolean NOT NULL DEFAULT false,   -- source de vérité pour la synchro
  PRIMARY KEY (provider, external_id)
);
CREATE INDEX media_external_ids_media_idx ON media_external_ids (media_id);
CREATE UNIQUE INDEX media_one_primary_source ON media_external_ids (media_id) WHERE is_primary;

-- Titres alternatifs (romaji, natif, anglais, français…) pour la recherche
CREATE TABLE media_titles (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  media_id  bigint NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  title     text NOT NULL,
  locale    text,            -- 'fr', 'en', 'ja-Latn', 'ja'…
  UNIQUE (media_id, title)
);
CREATE INDEX media_titles_trgm_idx ON media_titles USING gin (f_unaccent(lower(title)) gin_trgm_ops);

CREATE TABLE genres (
  id    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug  text NOT NULL UNIQUE,
  name  text NOT NULL
);
CREATE TABLE media_genres (
  media_id  bigint  NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  genre_id  integer NOT NULL REFERENCES genres (id) ON DELETE CASCADE,
  PRIMARY KEY (media_id, genre_id)
);

-- Saisons et épisodes (tv et anime) : suivi par épisode et calendrier des sorties
CREATE TABLE seasons (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  media_id       bigint NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  number         integer NOT NULL,           -- 0 = épisodes spéciaux
  title          text,
  air_date       date,
  episode_count  integer,
  poster_url     text,
  UNIQUE (media_id, number)
);

CREATE TABLE episodes (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  media_id         bigint NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  season_id        bigint REFERENCES seasons (id) ON DELETE CASCADE,
  number           integer NOT NULL,         -- numéro dans la saison
  absolute_number  integer,                  -- numérotation absolue (anime)
  title            text,
  air_date         timestamptz,
  runtime_minutes  integer,
  UNIQUE (season_id, number)
);
CREATE INDEX episodes_media_idx    ON episodes (media_id, absolute_number);
CREATE INDEX episodes_calendar_idx ON episodes (air_date);

-- ---------------------------------------------------------------------------
-- Bibliothèque de l'utilisateur
-- ---------------------------------------------------------------------------
CREATE TABLE library_entries (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id             uuid   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  media_id            bigint NOT NULL REFERENCES media (id) ON DELETE RESTRICT,
  status              entry_status NOT NULL DEFAULT 'planned',
  score               smallint CHECK (score BETWEEN 0 AND 100),  -- stocké sur 100, affiché selon users.rating_scale
  progress            integer NOT NULL DEFAULT 0 CHECK (progress >= 0),            -- épisodes / chapitres / pages
  progress_secondary  integer NOT NULL DEFAULT 0 CHECK (progress_secondary >= 0),  -- volumes / saisons
  repeat_count        integer NOT NULL DEFAULT 0,  -- revisionnages / relectures
  started_on          date,
  completed_on        date,
  review              text,
  notes               text,                   -- privées
  is_favorite         boolean NOT NULL DEFAULT false,
  is_private          boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, media_id)
);
CREATE INDEX library_user_status_idx ON library_entries (user_id, status, updated_at DESC);
CREATE INDEX library_media_idx       ON library_entries (media_id);

-- Épisodes vus individuellement (permet de sauter des épisodes, contrairement au seul compteur)
CREATE TABLE episode_views (
  user_id     uuid   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  episode_id  bigint NOT NULL REFERENCES episodes (id) ON DELETE CASCADE,
  viewed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, episode_id, viewed_at)
);

-- Journal d'activité : historique, statistiques, rétrospective annuelle
CREATE TABLE activity_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      uuid   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  media_id     bigint NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  episode_id   bigint REFERENCES episodes (id) ON DELETE SET NULL,
  kind         event_kind NOT NULL,
  amount       integer,                       -- ex. +3 chapitres, +40 pages
  minutes      integer,                       -- temps estimé, pour les stats
  source       event_source NOT NULL DEFAULT 'manual',
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  -- Dédoublonnage des webhooks Jellyfin/Plex et des imports rejoués
  dedup_key    text,
  UNIQUE (user_id, dedup_key)
);
CREATE INDEX activity_user_time_idx ON activity_events (user_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Listes personnalisées
-- ---------------------------------------------------------------------------
CREATE TABLE lists (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  visibility   visibility NOT NULL DEFAULT 'private',
  is_ranked    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lists_user_idx ON lists (user_id);

CREATE TABLE list_items (
  list_id   bigint NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  media_id  bigint NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  position  integer NOT NULL,
  note      text,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, media_id)
);

-- ---------------------------------------------------------------------------
-- Intégrations et imports
-- ---------------------------------------------------------------------------
CREATE TABLE integrations (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('jellyfin', 'plex', 'anilist', 'mal', 'trakt')),
  webhook_token   text UNIQUE,                -- jeton aléatoire dans l'URL du webhook
  credentials     bytea,                      -- jetons OAuth chiffrés côté application
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled         boolean NOT NULL DEFAULT true,
  last_synced_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind)
);

CREATE TABLE import_jobs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  source       text NOT NULL CHECK (source IN ('trakt', 'anilist', 'mal', 'goodreads',
                                               'storygraph', 'tvtime', 'letterboxd', 'csv')),
  status       job_status NOT NULL DEFAULT 'pending',
  stats        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"imported": 812, "unmatched": 14}
  unmatched    jsonb NOT NULL DEFAULT '[]'::jsonb,   -- lignes à rattacher à la main
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX import_jobs_user_idx ON import_jobs (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Maintien de updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER users_touch   BEFORE UPDATE ON users           FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER media_touch   BEFORE UPDATE ON media           FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER library_touch BEFORE UPDATE ON library_entries FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER lists_touch   BEFORE UPDATE ON lists           FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
