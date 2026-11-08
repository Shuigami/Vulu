CREATE TYPE "public"."entry_status" AS ENUM('planned', 'in_progress', 'completed', 'paused', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."event_kind" AS ENUM('episode', 'chapter', 'volume', 'pages', 'started', 'completed', 'rated', 'status_changed');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('manual', 'jellyfin', 'plex', 'import', 'api');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('movie', 'tv', 'anime', 'manga', 'book');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('tmdb', 'imdb', 'tvdb', 'anilist', 'mal', 'mangaupdates', 'openlibrary', 'isbn13', 'google_books', 'hardcover');--> statement-breakpoint
CREATE TYPE "public"."release_status" AS ENUM('announced', 'releasing', 'finished', 'cancelled', 'hiatus');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('private', 'unlisted', 'public');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"media_id" bigint NOT NULL,
	"episode_id" bigint,
	"kind" "event_kind" NOT NULL,
	"amount" integer,
	"minutes" integer,
	"source" "event_source" DEFAULT 'manual' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedup_key" text,
	CONSTRAINT "activity_events_user_id_dedup_key_key" UNIQUE("user_id","dedup_key")
);
--> statement-breakpoint
CREATE TABLE "episode_views" (
	"user_id" uuid NOT NULL,
	"episode_id" bigint NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episode_views_pkey" PRIMARY KEY("user_id","episode_id","viewed_at")
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "episodes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"media_id" bigint NOT NULL,
	"season_id" bigint,
	"number" integer NOT NULL,
	"absolute_number" integer,
	"title" text,
	"air_date" timestamp with time zone,
	"runtime_minutes" integer,
	CONSTRAINT "episodes_season_id_number_key" UNIQUE("season_id","number")
);
--> statement-breakpoint
CREATE TABLE "genres" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "genres_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "genres_slug_key" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"unmatched" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "import_jobs_source_check" CHECK ("import_jobs"."source" IN ('trakt', 'anilist', 'mal', 'goodreads', 'storygraph', 'tvtime', 'letterboxd', 'csv'))
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "integrations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"webhook_token" text,
	"credentials" "bytea",
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_webhook_token_key" UNIQUE("webhook_token"),
	CONSTRAINT "integrations_user_id_kind_key" UNIQUE("user_id","kind"),
	CONSTRAINT "integrations_kind_check" CHECK ("integrations"."kind" IN ('jellyfin', 'plex', 'anilist', 'mal', 'trakt'))
);
--> statement-breakpoint
CREATE TABLE "library_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "library_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"media_id" bigint NOT NULL,
	"status" "entry_status" DEFAULT 'planned' NOT NULL,
	"score" smallint,
	"progress" integer DEFAULT 0 NOT NULL,
	"progress_secondary" integer DEFAULT 0 NOT NULL,
	"repeat_count" integer DEFAULT 0 NOT NULL,
	"started_on" date,
	"completed_on" date,
	"review" text,
	"notes" text,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_entries_user_id_media_id_key" UNIQUE("user_id","media_id"),
	CONSTRAINT "library_entries_score_check" CHECK ("library_entries"."score" BETWEEN 0 AND 100),
	CONSTRAINT "library_entries_progress_check" CHECK ("library_entries"."progress" >= 0),
	CONSTRAINT "library_entries_progress_secondary_check" CHECK ("library_entries"."progress_secondary" >= 0)
);
--> statement-breakpoint
CREATE TABLE "list_items" (
	"list_id" bigint NOT NULL,
	"media_id" bigint NOT NULL,
	"position" integer NOT NULL,
	"note" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_items_pkey" PRIMARY KEY("list_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lists_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"visibility" "visibility" DEFAULT 'private' NOT NULL,
	"is_ranked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "media_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" "media_type" NOT NULL,
	"title" text NOT NULL,
	"original_title" text,
	"overview" text,
	"status" "release_status",
	"start_date" date,
	"end_date" date,
	"poster_url" text,
	"backdrop_url" text,
	"runtime_minutes" integer,
	"total_units" integer,
	"total_units_secondary" integer,
	"is_adult" boolean DEFAULT false NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_total_units_check" CHECK ("media"."total_units" >= 0),
	CONSTRAINT "media_total_units_secondary_check" CHECK ("media"."total_units_secondary" >= 0)
);
--> statement-breakpoint
CREATE TABLE "media_external_ids" (
	"media_id" bigint NOT NULL,
	"provider" "provider" NOT NULL,
	"external_id" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "media_external_ids_pkey" PRIMARY KEY("provider","external_id")
);
--> statement-breakpoint
CREATE TABLE "media_genres" (
	"media_id" bigint NOT NULL,
	"genre_id" integer NOT NULL,
	CONSTRAINT "media_genres_pkey" PRIMARY KEY("media_id","genre_id")
);
--> statement-breakpoint
CREATE TABLE "media_titles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "media_titles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"media_id" bigint NOT NULL,
	"title" text NOT NULL,
	"locale" text,
	CONSTRAINT "media_titles_media_id_title_key" UNIQUE("media_id","title")
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "seasons_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"media_id" bigint NOT NULL,
	"number" integer NOT NULL,
	"title" text,
	"air_date" date,
	"episode_count" integer,
	"poster_url" text,
	CONSTRAINT "seasons_media_id_number_key" UNIQUE("media_id","number")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"username" "citext" NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"locale" text DEFAULT 'fr' NOT NULL,
	"rating_scale" smallint DEFAULT 10 NOT NULL,
	"profile_visibility" "visibility" DEFAULT 'private' NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_key" UNIQUE("email"),
	CONSTRAINT "users_username_key" UNIQUE("username"),
	CONSTRAINT "users_username_check" CHECK ("users"."username" ~ '^[a-zA-Z0-9_]{3,30}$'),
	CONSTRAINT "users_rating_scale_check" CHECK ("users"."rating_scale" IN (5, 10, 100))
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_views" ADD CONSTRAINT "episode_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_views" ADD CONSTRAINT "episode_views_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entries" ADD CONSTRAINT "library_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entries" ADD CONSTRAINT "library_entries_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_external_ids" ADD CONSTRAINT "media_external_ids_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_genres" ADD CONSTRAINT "media_genres_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_genres" ADD CONSTRAINT "media_genres_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_titles" ADD CONSTRAINT "media_titles_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_user_time_idx" ON "activity_events" USING btree ("user_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "episodes_media_idx" ON "episodes" USING btree ("media_id","absolute_number");--> statement-breakpoint
CREATE INDEX "episodes_calendar_idx" ON "episodes" USING btree ("air_date");--> statement-breakpoint
CREATE INDEX "import_jobs_user_idx" ON "import_jobs" USING btree ("user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "library_user_status_idx" ON "library_entries" USING btree ("user_id","status","updated_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "library_media_idx" ON "library_entries" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "lists_user_idx" ON "lists" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "media_type_idx" ON "media" USING btree ("type");--> statement-breakpoint
CREATE INDEX "media_sync_queue_idx" ON "media" USING btree ("last_synced_at") WHERE "media"."status" IN ('releasing', 'announced');--> statement-breakpoint
CREATE INDEX "media_external_ids_media_idx" ON "media_external_ids" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_one_primary_source" ON "media_external_ids" USING btree ("media_id") WHERE "media_external_ids"."is_primary";--> statement-breakpoint
CREATE INDEX "media_titles_trgm_idx" ON "media_titles" USING gin (f_unaccent(lower("title")) gin_trgm_ops);