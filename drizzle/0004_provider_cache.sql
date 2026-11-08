CREATE TABLE "provider_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "provider_cache_expires_idx" ON "provider_cache" USING btree ("expires_at");