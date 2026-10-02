-- The profile JSON moved to a new shape (Simplify-style sections, EEO inside
-- `data`). Old-shape profiles are not migrated: they are deleted, and their
-- applications go with them through the profile_id cascade.
DELETE FROM "profiles";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "eeo";
