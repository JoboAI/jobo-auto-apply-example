CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`scope` text,
	`password` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `saved_jobs` (
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `job_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `worker_health` (
	`id` text PRIMARY KEY NOT NULL,
	`heartbeat_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `applications` ADD `user_id` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `applications` ADD `job_id` text;--> statement-breakpoint
ALTER TABLE `applications` ADD `job_snapshot` text;--> statement-breakpoint
ALTER TABLE `applications` ADD `profile_snapshot` text;--> statement-breakpoint
ALTER TABLE `applications` ADD `lease_owner` text;--> statement-breakpoint
ALTER TABLE `applications` ADD `lease_until` integer;--> statement-breakpoint
ALTER TABLE `applications` ADD `attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `applications` ADD `next_attempt_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `applications` ADD `cancel_requested` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `applications` ADD `stop_reason` text;--> statement-breakpoint
ALTER TABLE `applications` ADD `worker_error` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `user_id` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `profiles` ADD `reviewed_at` integer;--> statement-breakpoint
ALTER TABLE `profiles` ADD `archived` integer DEFAULT false NOT NULL;