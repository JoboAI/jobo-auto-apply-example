CREATE TABLE `api_exchanges` (
  `id` text PRIMARY KEY NOT NULL,
  `application_id` text NOT NULL REFERENCES `applications`(`id`) ON DELETE CASCADE,
  `method` text NOT NULL,
  `url` text NOT NULL,
  `request_json` text NOT NULL,
  `response_json` text,
  `status_code` integer,
  `error` text,
  `started_at` integer NOT NULL,
  `finished_at` integer,
  `elapsed_ms` integer
);
--> statement-breakpoint
CREATE INDEX `api_exchanges_application_idx` ON `api_exchanges` (`application_id`, `started_at`);
