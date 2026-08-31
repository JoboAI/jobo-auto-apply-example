import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { Answer, CommandError, Field } from '@jobo-ai/autoapply'
import type { ResumeProfile, EeoAnswers } from '@/lib/resume/profile-schema'
import type { AnswerTrace } from '@/lib/answers/types'

/**
 * The whole persistence layer. Three tables.
 *
 * SQLite is not the point of the example, but two of these choices are:
 *
 *  1. `applications.idempotency_key` is NOT NULL UNIQUE and is written BEFORE
 *     the network call. If the blocking create drops mid-hold you cannot know
 *     whether Jobo accepted it — the only safe retry is one that reuses this
 *     exact key (it re-attaches to the in-flight application and its wait),
 *     and it can only exist beforehand if you wrote it beforehand.
 *
 *  2. `steps` is keyed on (step_id, correction_round). A correction round
 *     re-issues the SAME step with the round incremented, and each round is a
 *     separate exchange worth auditing — what the ATS rejected, what was
 *     re-sent, what the model was told. One row per exchange.
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
   * Retained so existing local databases remain readable without a migration.
   * The answer pipeline never reads or submits these values: sensitive fields
   * use only an advertised decline option or remain unanswered.
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

    /** Null until the blocking create returns. */
    joboApplicationId: text('jobo_application_id').unique(),

    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),

    applyUrl: text('apply_url').notNull(),
    sandbox: integer('sandbox', { mode: 'boolean' }).notNull().default(false),
    scenarioSlug: text('scenario_slug'),

    /**
     * Jobo's six statuses, plus two local-only ones: `creating` (the blocking
     * create is in flight) and `create_failed` (it never reached Jobo).
     */
    status: text('status').notNull(),

    providerId: text('provider_id'),
    providerName: text('provider_name'),

    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    failureRetryable: integer('failure_retryable', { mode: 'boolean' }),

    /** e.g. `unsupported_ats` — distinct from a post-creation failure. */
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

/**
 * One row per answer exchange: a step at a given correction round. This is the
 * audit trail the inspector, timeline and trace table read — the fields Jobo
 * discovered, the answers this app sent, why each answer was chosen, and what
 * the ATS rejected. It also outlives the data upstream: Jobo purges sandbox
 * applications after 24 hours.
 */
export const steps = sqliteTable(
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
    fieldsJson: text('fields_json', { mode: 'json' }).$type<Field[]>(),
    /** The complete answer snapshot this app submitted for this round. */
    answersJson: text('answers_json', { mode: 'json' }).$type<Answer[]>(),
    /** Why the PREVIOUS round was rejected — the ATS's own errors. */
    commandErrorsJson: text('command_errors_json', { mode: 'json' }).$type<CommandError[]>(),

    /** answering | submitted | canceled | error. Local, not a Jobo status. */
    status: text('status').notNull(),

    /** Per-field provenance: deterministic rule id, LLM reasoning, repairs. */
    trace: text('trace', { mode: 'json' }).$type<AnswerTrace[]>(),

    llmModel: text('llm_model'),
    llmMs: integer('llm_ms'),
    /** Receipt of the fields to acceptance of the answers, wall clock. */
    totalMs: integer('total_ms'),
    error: text('error'),

    /** When the blocking call handed this round's fields to us. */
    receivedAt: integer('received_at').notNull().default(sql`(unixepoch() * 1000)`),
    /** When submitAnswers accepted the snapshot. Null if never submitted. */
    submittedAt: integer('submitted_at')
  },
  (table) => [
    primaryKey({ columns: [table.stepId, table.correctionRound] }),
    index('steps_application_idx').on(table.applicationId, table.receivedAt)
  ]
)

export type ProfileRow = typeof profiles.$inferSelect
export type ApplicationRow = typeof applications.$inferSelect
export type StepRow = typeof steps.$inferSelect
