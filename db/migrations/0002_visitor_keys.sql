ALTER TABLE "applications" ADD COLUMN "create_error_detail" text;--> statement-breakpoint
-- The environment now follows the stored key's prefix. A visitor who had
-- switched back to sandbox while keeping a live key connected must not land
-- in production: forget that key, and they connect one again.
UPDATE "user_settings" SET "api_key_ciphertext" = NULL, "api_key_hint" = NULL WHERE "mode" <> 'production';--> statement-breakpoint
ALTER TABLE "user_settings" DROP COLUMN "mode";
