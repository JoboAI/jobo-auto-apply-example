CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'sandbox' NOT NULL,
	"api_key_ciphertext" text,
	"api_key_hint" text,
	"production_acknowledged_at" bigint,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "api_key_ciphertext" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;