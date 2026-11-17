CREATE TABLE "episode_ratings" (
	"user_id" uuid NOT NULL,
	"episode_id" bigint NOT NULL,
	"score" smallint NOT NULL,
	"rated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episode_ratings_pkey" PRIMARY KEY("user_id","episode_id"),
	CONSTRAINT "episode_ratings_score_check" CHECK ("episode_ratings"."score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "overview" text;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "still_url" text;--> statement-breakpoint
ALTER TABLE "episode_ratings" ADD CONSTRAINT "episode_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_ratings" ADD CONSTRAINT "episode_ratings_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_ratings_episode_idx" ON "episode_ratings" USING btree ("episode_id");