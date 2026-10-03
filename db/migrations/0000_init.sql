CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"scope" text,
	"password" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_exchanges" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"method" text NOT NULL,
	"url" text NOT NULL,
	"request_json" text NOT NULL,
	"response_json" text,
	"status_code" integer,
	"error" text,
	"started_at" bigint NOT NULL,
	"finished_at" bigint,
	"elapsed_ms" integer
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"job_id" text NOT NULL,
	"job_snapshot" jsonb NOT NULL,
	"profile_snapshot" jsonb NOT NULL,
	"lease_owner" text,
	"lease_until" bigint,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" bigint DEFAULT 0 NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"stop_reason" text,
	"worker_error" text,
	"idempotency_key" text NOT NULL,
	"jobo_application_id" text,
	"profile_id" text NOT NULL,
	"apply_url" text NOT NULL,
	"sandbox" boolean DEFAULT false NOT NULL,
	"api_key_ciphertext" text,
	"scenario_slug" text,
	"status" text NOT NULL,
	"provider_id" text,
	"provider_name" text,
	"failure_code" text,
	"failure_message" text,
	"failure_retryable" boolean,
	"create_error_code" text,
	"last_synced_at" bigint,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "applications_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "applications_jobo_application_id_unique" UNIQUE("jobo_application_id")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"reviewed_at" bigint,
	"archived" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"data" jsonb NOT NULL,
	"resume_filename" text NOT NULL,
	"resume_content_type" text NOT NULL,
	"resume_bytes" integer NOT NULL,
	"resume_sha256" text NOT NULL,
	"resume_text" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_jobs" (
	"user_id" text NOT NULL,
	"job_id" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "saved_jobs_user_id_job_id_pk" PRIMARY KEY("user_id","job_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "steps" (
	"step_id" text NOT NULL,
	"correction_round" integer DEFAULT 0 NOT NULL,
	"application_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"fields_json" jsonb,
	"answers_json" jsonb,
	"command_errors_json" jsonb,
	"status" text NOT NULL,
	"trace" jsonb,
	"llm_model" text,
	"llm_ms" integer,
	"total_ms" integer,
	"error" text,
	"received_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"submitted_at" bigint,
	CONSTRAINT "steps_step_id_correction_round_pk" PRIMARY KEY("step_id","correction_round")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'sandbox' NOT NULL,
	"api_key_ciphertext" text,
	"api_key_hint" text,
	"production_acknowledged_at" bigint,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_health" (
	"id" text PRIMARY KEY NOT NULL,
	"heartbeat_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_exchanges" ADD CONSTRAINT "api_exchanges_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_jobs" ADD CONSTRAINT "saved_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steps" ADD CONSTRAINT "steps_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_exchanges_application_idx" ON "api_exchanges" USING btree ("application_id","started_at");--> statement-breakpoint
CREATE INDEX "applications_status_idx" ON "applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "applications_created_idx" ON "applications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "steps_application_idx" ON "steps" USING btree ("application_id","received_at");