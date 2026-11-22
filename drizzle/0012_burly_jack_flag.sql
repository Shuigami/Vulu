CREATE TABLE "review_likes" (
	"user_id" uuid NOT NULL,
	"entry_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_likes_pkey" PRIMARY KEY("user_id","entry_id")
);
--> statement-breakpoint
ALTER TABLE "review_likes" ADD CONSTRAINT "review_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_likes" ADD CONSTRAINT "review_likes_entry_id_library_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."library_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_likes_entry_idx" ON "review_likes" USING btree ("entry_id");