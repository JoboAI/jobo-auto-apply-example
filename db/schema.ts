import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import type { Answer, CommandError, Field } from '@jobo-ai/autoapply'
import type { ResumeProfile } from '@/lib/resume/profile-schema'
import type { Job } from '@/lib/jobs-types'
import type { AnswerTrace } from '@/lib/answers/types'

/**
 * Wall-clock milliseconds, as a JavaScript number. App code compares these
 * with Date.now() throughout; int4 would overflow, and a timestamp column would
 * turn every one of those comparisons into a Date.
 */
const epochMs = (name: string) => bigint(name, { mode: 'number' })
const nowMs = sql`(extract(epoch from now()) * 1000)::bigint`
/** better-auth's own columns are real timestamps. */
const authTime = (name: string) => timestamp(name, { mode: 'date', withTimezone: true })

/**
 * The database has three groups of tables:
 *
 *  - better-auth's own tables (`user`, `session`, `account`, `verification`),
 *    in the shape its Drizzle adapter expects.
 *  - Candidate data: `profiles` (one reviewed resume each), `saved_jobs` and
 *    `user_settings`. Every row belongs to one user and is deleted with them.
 *  - The application engine: `applications` (one durable row per Apply click,
 *    with snapshots of the profile and job so later edits cannot change a run
 *    in flight, plus the worker lease), `steps` (one audit row per answered
 *    step round) and `api_exchanges` (redacted HTTP captures).
 */

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: authTime('created_at').notNull(),
  updatedAt: authTime('updated_at').notNull(),
})
export const session = pgTable('session', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: authTime('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: authTime('created_at').notNull(),
  updatedAt: authTime('updated_at').notNull(),
})
export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  scope: text('scope'),
  password: text('password'),
  accessTokenExpiresAt: authTime('access_token_expires_at'),
  refreshTokenExpiresAt: authTime('refresh_token_expires_at'),
  createdAt: authTime('created_at').notNull(),
  updatedAt: authTime('updated_at').notNull(),
})
export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: authTime('expires_at').notNull(),
  createdAt: authTime('created_at').notNull(),
  updatedAt: authTime('updated_at').notNull(),
})
export const savedJobs = pgTable(
  'saved_jobs',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    jobId: text('job_id').notNull(),
    createdAt: epochMs('created_at').notNull().default(nowMs),
  },
  (t) => [primaryKey({ columns: [t.userId, t.jobId] })],
)
export const workerHealth = pgTable('worker_health', {
  id: text('id').primaryKey(),
  heartbeatAt: epochMs('heartbeat_at').notNull(),
})
export interface ProfileSnapshot {
  data: ResumeProfile
  resumeText: string
  resumeFilename: string
  resumeContentType: string
}

export const profiles = pgTable('profiles', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  reviewedAt: epochMs('reviewed_at'),
  archived: boolean('archived').notNull().default(false),
  name: text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),

  /**
   * The structured profile, as JSON — including the candidate's voluntary
   * self-identification (`data.eeo`). Deliberately NOT normalised into a dozen
   * tables: it is read whole, written whole, and never queried by field.
   * Normalising it would triple the schema and teach nothing about Auto Apply.
   */
  data: jsonb('data').$type<ResumeProfile>().notNull(),

  resumeFilename: text('resume_filename').notNull(),
  resumeContentType: text('resume_content_type').notNull(),
  resumeBytes: integer('resume_bytes').notNull(),
  resumeSha256: text('resume_sha256').notNull(),

  /**
   * The raw extracted text. Kept because structuring always loses something,
   * and open-ended questions often need the candidate's original phrasing.
   */
  resumeText: text('resume_text').notNull(),

  createdAt: epochMs('created_at').notNull().default(nowMs),
  updatedAt: epochMs('updated_at').notNull().default(nowMs),
})

/**
 * The visitor's own Jobo API key, stored sealed (lib/secret-box.ts) because
 * the background worker needs it with no browser present. Its prefix picks
 * sandbox or production (lib/jobo/environment.ts).
 */
export const userSettings = pgTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  apiKeyCiphertext: text('api_key_ciphertext'),
  /** Last four characters, so the UI can say which key is connected. */
  apiKeyHint: text('api_key_hint'),
  /** When the visitor accepted the one-time "real employers" warning for a production key. */
  productionAcknowledgedAt: epochMs('production_acknowledged_at'),
  /** When the visitor allowed AI-generated answers (lib/ai-consent.ts), and which wording. */
  aiAnswersConsentAt: epochMs('ai_answers_consent_at'),
  aiAnswersConsentVersion: text('ai_answers_consent_version'),
  updatedAt: epochMs('updated_at').notNull().default(nowMs),
})
export type UserSettingsRow = typeof userSettings.$inferSelect

export const applications = pgTable(
  'applications',
  {
    /** Our local id — the one in the browser URL. */
    id: text('id').primaryKey(),

    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The Jobo job UUID. */
    jobId: text('job_id').notNull(),
    /** Frozen copies taken at Apply time: a run never sees later edits. */
    jobSnapshot: jsonb('job_snapshot').$type<Job>().notNull(),
    profileSnapshot: jsonb('profile_snapshot').$type<ProfileSnapshot>().notNull(),
    /**
     * Worker lease. A worker owns the row while `leaseUntil` is in the future
     * and renews it on a heartbeat; every engine write is conditional on the
     * owner, so a worker that lost its lease cannot overwrite the new owner.
     */
    leaseOwner: text('lease_owner'),
    leaseUntil: epochMs('lease_until'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: epochMs('next_attempt_at').notNull().default(0),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    /** Why this app stopped the run, shown to the candidate. */
    stopReason: text('stop_reason'),
    workerError: text('worker_error'),
    /**
     * Generated and stored at enqueue, before the first create call. Replaying
     * create with the same key after a timeout or crash re-attaches to the
     * application Jobo already started instead of submitting a second one.
     */
    idempotencyKey: text('idempotency_key').notNull().unique(),

    /** Null until the blocking create returns. */
    joboApplicationId: text('jobo_application_id').unique(),

    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),

    applyUrl: text('apply_url').notNull(),
    /** Queued on a sandbox key (`jbe_test_…`), from the key's prefix. */
    sandbox: boolean('sandbox').notNull().default(false),
    /**
     * The visitor's Jobo API key, sealed with API_KEY_ENCRYPTION_SECRET when
     * the application was queued. Kept on the row so a run finishes on the key
     * it started with even if the visitor replaces it; cleared once the
     * application is terminal.
     */
    apiKeyCiphertext: text('api_key_ciphertext'),

    /**
     * Jobo's application statuses, plus three local-only ones: `creating` (the
     * blocking create is in flight), `create_failed` (it never reached Jobo)
     * and `recovery_required` (repeated failures; paused for reconciliation).
     */
    status: text('status').notNull(),

    providerId: text('provider_id'),
    providerName: text('provider_name'),

    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    failureRetryable: boolean('failure_retryable'),

    /** e.g. `unsupported_ats` — distinct from a post-creation failure. */
    createErrorCode: text('create_error_code'),
    /** The API's own explanation of that refusal (its problem `detail`). */
    createErrorDetail: text('create_error_detail'),

    lastSyncedAt: epochMs('last_synced_at'),
    createdAt: epochMs('created_at').notNull().default(nowMs),
    updatedAt: epochMs('updated_at').notNull().default(nowMs),
  },
  (table) => [
    index('applications_status_idx').on(table.status),
    index('applications_created_idx').on(table.createdAt),
  ],
)

/**
 * One row per answer exchange: a step at a given correction round. This is the
 * audit trail the inspector, timeline and trace table read — the fields Jobo
 * discovered, the answers this app sent, why each answer was chosen, and what
 * the ATS rejected. It also outlives the data upstream: Jobo purges sandbox
 * applications after 24 hours.
 */
export const steps = pgTable(
  'steps',
  {
    /** Jobo's step id. Stable across correction rounds of the same step. */
    stepId: text('step_id').notNull(),
    correctionRound: integer('correction_round').notNull().default(0),

    applicationId: text('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),

    sequence: integer('sequence').notNull(),

    /** The full field list Jobo sent for this round. */
    fieldsJson: jsonb('fields_json').$type<Field[]>(),
    /** The complete answer snapshot this app submitted for this round. */
    answersJson: jsonb('answers_json').$type<Answer[]>(),
    /** Why the PREVIOUS round was rejected — the ATS's own errors. */
    commandErrorsJson: jsonb('command_errors_json').$type<CommandError[]>(),

    /** answering | submitted | canceled | error. Local, not a Jobo status. */
    status: text('status').notNull(),

    /** Per-field provenance: deterministic rule id, LLM reasoning, repairs. */
    trace: jsonb('trace').$type<AnswerTrace[]>(),

    llmModel: text('llm_model'),
    llmMs: integer('llm_ms'),
    /** Receipt of the fields to acceptance of the answers, wall clock. */
    totalMs: integer('total_ms'),
    error: text('error'),

    /** When the blocking call handed this round's fields to us. */
    receivedAt: epochMs('received_at').notNull().default(nowMs),
    /** When submitAnswers accepted the snapshot. Null if never submitted. */
    submittedAt: epochMs('submitted_at'),
  },
  (table) => [
    primaryKey({ columns: [table.stepId, table.correctionRound] }),
    index('steps_application_idx').on(table.applicationId, table.receivedAt),
  ],
)

export type ProfileRow = typeof profiles.$inferSelect
export type ApplicationRow = typeof applications.$inferSelect
export type StepRow = typeof steps.$inferSelect

/** Redacted HTTP exchanges; access is inherited from the owning application. */
export const apiExchanges = pgTable(
  'api_exchanges',
  {
    id: text('id').primaryKey(),
    applicationId: text('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    url: text('url').notNull(),
    requestJson: text('request_json').notNull(),
    responseJson: text('response_json'),
    statusCode: integer('status_code'),
    error: text('error'),
    startedAt: epochMs('started_at').notNull(),
    finishedAt: epochMs('finished_at'),
    elapsedMs: integer('elapsed_ms'),
  },
  (t) => [index('api_exchanges_application_idx').on(t.applicationId, t.startedAt)],
)
export type ApiExchangeRow = typeof apiExchanges.$inferSelect
