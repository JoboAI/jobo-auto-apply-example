CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`jobo_application_id` text,
	`profile_id` text NOT NULL,
	`apply_url` text NOT NULL,
	`sandbox` integer DEFAULT false NOT NULL,
	`scenario_slug` text,
	`status` text NOT NULL,
	`provider_id` text,
	`provider_name` text,
	`failure_code` text,
	`failure_message` text,
	`failure_retryable` integer,
	`create_error_code` text,
	`create_error_message` text,
	`last_synced_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applications_idempotency_key_unique` ON `applications` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `applications_jobo_application_id_unique` ON `applications` (`jobo_application_id`);--> statement-breakpoint
CREATE INDEX `applications_status_idx` ON `applications` (`status`);--> statement-breakpoint
CREATE INDEX `applications_created_idx` ON `applications` (`created_at`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`data` text NOT NULL,
	`eeo` text,
	`resume_filename` text NOT NULL,
	`resume_content_type` text NOT NULL,
	`resume_bytes` integer NOT NULL,
	`resume_sha256` text NOT NULL,
	`resume_text` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`jobo_application_id` text,
	`application_id` text,
	`type` text NOT NULL,
	`correction_round` integer,
	`first_attempt` integer DEFAULT 1 NOT NULL,
	`attempts_seen` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`raw_body` text NOT NULL,
	`response_body` text,
	`trace` text,
	`llm_model` text,
	`llm_ms` integer,
	`total_ms` integer,
	`error` text,
	`received_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`responded_at` integer,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_events_application_idx` ON `webhook_events` (`application_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `webhook_events_jobo_application_idx` ON `webhook_events` (`jobo_application_id`);