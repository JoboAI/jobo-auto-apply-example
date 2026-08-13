CREATE TABLE `steps` (
	`step_id` text NOT NULL,
	`correction_round` integer DEFAULT 0 NOT NULL,
	`application_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`fields_json` text,
	`answers_json` text,
	`command_errors_json` text,
	`status` text NOT NULL,
	`trace` text,
	`llm_model` text,
	`llm_ms` integer,
	`total_ms` integer,
	`error` text,
	`received_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`submitted_at` integer,
	PRIMARY KEY(`step_id`, `correction_round`),
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `steps_application_idx` ON `steps` (`application_id`,`received_at`);--> statement-breakpoint
DROP TABLE `webhook_events`;