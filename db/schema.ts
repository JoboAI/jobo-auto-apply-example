import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { ResumeProfile, EeoAnswers } from '@/lib/resume/profile-schema'
import type { AnswerTrace } from '@/lib/answers/types'

/**
 * The whole persistence layer. Three tables.
 *
 * SQLite is not the point of the example, but two of these choices are:
 *
 *  1. `webhook_events.id` is the `evt_...` value itself, as the primary key.
 *     Replay protection is therefore a UNIQUE constraint enforced by the
 *     database, not a check-then-act race in application code.
 *
 *  2. `applications.idempotency_key` is NOT NULL UNIQUE and is written BEFORE
 *     the network call. If the create times out you cannot know whether Jobo
 *     accepted it — the only safe retry is one that reuses this exact key, and
 *     it can only exist beforehand if you wrote it beforehand.
 */

export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),

  /**
   * The structured profile, as JSON. Deliberately NOT normalised into eight
   * tables: it is read whole, written whole, and never queried by field.
   * Normalising it would triple the schema and teach nothing about Auto Apply.
   */
  data: text('data', { mode: 'json' }).$type<ResumeProfile>().notNull(),

  /**
   * Voluntary self-identification answers. Populated ONLY by explicit user
   * input in the UI, never by the resume parser and never by the answer LLM.
   * Jobo marks these fields `sensitive: true` and never infers them; this app
   * takes the same position. See lib/answers/deterministic.ts.
   */
  eeo: text('eeo', { mode: 'json' }).$type<EeoAnswers>(),

  resumeFilename: text('resume_filename').notNull(),
  resumeContentType: text('resume_content_type').notNull(),
  resumeBytes: integer('resume_bytes').notNull(),
  resumeSha256: text('resume_sha256').notNull(),

  /**
   * The raw extracted text. Kept because structuring always loses something,
   * and open-ended questions often need the candidate's original phrasing.
   */
  resumeText: text('resume_text').notNull(),

  createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`)
})

export const applications = sqliteTable(
  'applications',
  {
    /** Our local id — the one in the browser URL. */
    id: text('id').primaryKey(),

    /** Written before the create call. See the note at the top of this file. */
    idempotencyKey: text('idempotency_key').notNull().unique(),

    /** Null until create returns 202. */
    joboApplicationId: text('jobo_application_id').unique(),

    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),

    applyUrl: text('apply_url').notNull(),
    sandbox: integer('sandbox', { mode: 'boolean' }).notNull().default(false),
    scenarioSlug: text('scenario_slug'),

    /**
     * Jobo's six statuses, plus two local-only ones: `creating` (the request is
     * in flight) and `create_failed` (it never reached Jobo).
     */
    status: text('status').notNull(),

    providerId: text('provider_id'),
    providerName: text('provider_name'),

    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    failureRetryable: integer('failure_retryable', { mode: 'boolean' }),

    /** e.g. `auto_apply_coming_soon` — distinct from a post-creation failure. */
    createErrorCode: text('create_error_code'),
    createErrorMessage: text('create_error_message'),

    lastSyncedAt: integer('last_synced_at'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`)
  },
  (table) => [
    index('applications_status_idx').on(table.status),
    index('applications_created_idx').on(table.createdAt)
  ]
)

export const webhookEvents = sqliteTable(
  'webhook_events',
  {
    /** The `evt_...` id. THE idempotency guarantee — see the top of this file. */
    id: text('id').primaryKey(),

    joboApplicationId: text('jobo_application_id'),
    applicationId: text('application_id').references(() => applications.id, {
      onDelete: 'cascade'
    }),

    type: text('type').notNull(),
    correctionRound: integer('correction_round'),

    /** X-Jobo-Delivery-Attempt when we first saw this event. */
    firstAttempt: integer('first_attempt').notNull().default(1),
    /** Incremented on every replay of the same event id. */
    attemptsSeen: integer('attempts_seen').notNull().default(1),

    status: text('status').notNull(),

    /**
     * Exactly the bytes that arrived, and exactly the bytes we returned.
     * This is what makes the callback log inspector genuinely useful — and it
     * matters because Jobo purges sandbox applications after 24 hours.
     */
    rawBody: text('raw_body').notNull(),
    responseBody: text('response_body'),

    /** Per-field provenance: deterministic rule id, LLM reasoning, repairs. */
    trace: text('trace', { mode: 'json' }).$type<AnswerTrace[]>(),

    llmModel: text('llm_model'),
    llmMs: integer('llm_ms'),
    totalMs: integer('total_ms'),
    error: text('error'),

    receivedAt: integer('received_at').notNull().default(sql`(unixepoch() * 1000)`),
    respondedAt: integer('responded_at')
  },
  (table) => [
    index('webhook_events_application_idx').on(table.applicationId, table.receivedAt),
    index('webhook_events_jobo_application_idx').on(table.joboApplicationId)
  ]
)

export type ProfileRow = typeof profiles.$inferSelect
export type ApplicationRow = typeof applications.$inferSelect
export type WebhookEventRow = typeof webhookEvents.$inferSelect
