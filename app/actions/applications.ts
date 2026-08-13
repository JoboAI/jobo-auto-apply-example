'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { applications, profiles, steps, type ApplicationRow } from '@/db/schema'
import { config } from '@/lib/config'
import {
  JoboAPIError,
  JoboValidationError,
  type Application,
  type ApplicationStep
} from '@jobo-ai/autoapply'
import { jobo } from '@/lib/jobo/client'
import { explain } from '@/lib/jobo/problem'
import { buildAnswers, repairAnswers } from '@/lib/answers'
import type { AnswerContext } from '@/lib/answers/types'
import { emptyEeo } from '@/lib/resume/profile-schema'
import { signResumeUrl } from '@/lib/signed-url'
import { isTerminal } from '@/lib/status'
import { hostAllowed, parseAllowedHosts } from '@/lib/apply-hosts'
import { log } from '@/lib/logger'

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  THE CENTREPIECE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Everything interesting about integrating Auto Apply happens in this file.
 *
 * Auto Apply is profileless: Jobo stores no candidate data and generates no
 * answers. The integration is a synchronous loop of exactly two blocking
 * calls, one browser request each:
 *
 *   startApplicationAction    create() — BLOCKS until the first step's fields
 *                             are discovered (typically 10s–3min), then
 *                             persists the application and its current step.
 *
 *   advanceApplicationAction  one turn of the loop — re-attach to the
 *                             application, answer the current step with the
 *                             answer engine, submitAnswers() (which BLOCKS
 *                             while Jobo fills the form and clicks through),
 *                             and persist whatever comes back: the next step,
 *                             a correction round, or the terminal result.
 *                             components/AutoRunner.tsx calls this repeatedly
 *                             until the application is terminal.
 *
 * There are no webhooks, no tunnels and no polling loops — the response to
 * each call IS the next state.
 *
 * Three deadlines shape the code:
 *
 *  1. Each answerable step has `answers_expire_at` (~3 minutes; 60s for
 *     one-time codes). A real browser is holding the employer's form open
 *     while the answers are produced — miss it and the application fails with
 *     `answers_timeout`. The LLM budget is derived from it.
 *
 *  2. Blocking calls are held server-side for up to ~9 minutes, then answer
 *     202 with a snapshot. `get(id, { waitSeconds: 540 })` is the re-attach
 *     path — the SDK's own timeout sits just above the server's hold.
 *
 *  3. Validation is free. submitAnswers checks every value BEFORE anything
 *     touches the employer's form; a bad answer is an immediate 400 with
 *     per-field errors and costs nothing. The repair pass keys off exactly
 *     those errors. Only the employer ATS's own rejections consume one of the
 *     3 correction rounds.
 */

/**
 * Held back from the step deadline for everything that is not the LLM call:
 * the submitAnswers round-trip, persistence, and — easy to forget — Jobo's
 * own download of the resume file, which happens while the step is open.
 */
const RESERVE_MS = 20_000

/** Server-side cap on GET ?wait_seconds. */
const MAX_WAIT_SECONDS = 540

export interface StartInput {
  profileId: string
  applyUrl: string
  sandbox: boolean
  scenarioSlug?: string
}

export type StartResult =
  | { ok: true; id: string }
  | { ok: false; error: string; code?: string }

export interface AdvanceState {
  ok: boolean
  /** The local status after this advance (Jobo's six, or creating/create_failed). */
  status: string
  terminal: boolean
  /** Present while a step is awaiting answers. */
  stepSequence?: number
  correctionRound?: number
  error?: string
  code?: string
}

/**
 * Enforced here rather than in the form, because the form is not the only way
 * in — this is a server action, and anything that can POST to the app can call
 * it with a URL of its choosing. Runs before the local row is written, so a
 * refused attempt leaves nothing behind.
 */
function refuseDisallowedHost(applyUrl: string): string | null {
  const c = config()
  if (!c.RESTRICT_APPLY_HOSTS) return null
  let host: string
  try {
    host = new URL(applyUrl).hostname
  } catch {
    return 'That is not a valid URL.'
  }
  const allowed = parseAllowedHosts(c.ALLOWED_APPLY_HOSTS)
  if (hostAllowed(host, allowed)) return null
  return `This deployment only accepts apply URLs on ${allowed.join(', ')}. Run it yourself to apply anywhere else.`
}

/**
 * Start an application.
 *
 * The ordering here is the point. The local row and its Idempotency-Key are
 * written BEFORE the network call, because the create BLOCKS for up to
 * minutes and this process may not live to see the response — and the only
 * safe retry is one that reuses the exact same key, which RE-ATTACHES to the
 * in-flight application and its blocking wait rather than creating a second
 * application. advanceApplicationAction leans on exactly that: a row stuck in
 * `creating` is recovered by replaying create with the stored key.
 */
export async function startApplicationAction(input: StartInput): Promise<StartResult> {
  const refusal = refuseDisallowedHost(input.applyUrl)
  if (refusal) {
    log.warn({ applyUrl: input.applyUrl }, 'refused a disallowed apply host')
    return { ok: false, error: refusal, code: 'host_not_allowed' }
  }

  const id = randomUUID()
  const idempotencyKey = randomUUID()

  db.insert(applications)
    .values({
      id,
      idempotencyKey,
      profileId: input.profileId,
      applyUrl: input.applyUrl,
      sandbox: input.sandbox,
      scenarioSlug: input.scenarioSlug ?? null,
      status: 'creating'
    })
    .run()

  try {
    // BLOCKS until the first step's fields are discovered — typically 10s to
    // 3 minutes. If the server's hold budget expires first this resolves with
    // a 202 snapshot (status still queued/running) and the advance loop
    // re-attaches with get(id, { waitSeconds }).
    const created = await jobo().applications.create(
      {
        apply_url: input.applyUrl
        // No `sandbox` flag: sandbox mode is a property of the credential you
        // call with, not of the request.
      },
      { idempotencyKey }
    )

    persistApplication(id, created)
    log.info(
      {
        id,
        joboId: created.id,
        provider: created.provider_name,
        status: created.status,
        step: created.current_step?.sequence
      },
      'created application'
    )
    revalidatePath('/applications')
    return { ok: true, id }
  } catch (error) {
    const isApiError = error instanceof JoboAPIError
    const message = isApiError ? explain(error) : String(error)
    const code = isApiError ? error.code : 'network_error'

    db.update(applications)
      .set({
        status: 'create_failed',
        createErrorCode: code,
        createErrorMessage: message,
        updatedAt: Date.now()
      })
      .where(eq(applications.id, id))
      .run()

    log.warn({ id, code, message }, 'create failed')
    revalidatePath('/applications')
    return { ok: false, error: message, code }
  }
}

/**
 * One turn of the loop. Safe to call repeatedly and safe to call twice: reads
 * re-attach, submits are exactly-once per correction round server-side, and a
 * duplicate post attaches to the same wait instead of double-answering.
 */
export async function advanceApplicationAction(id: string): Promise<AdvanceState> {
  const local = db.select().from(applications).where(eq(applications.id, id)).get()
  if (!local) return { ok: false, status: 'unknown', terminal: true, error: 'No such application.' }

  if (local.status === 'create_failed') {
    return {
      ok: false,
      status: local.status,
      terminal: true,
      error: local.createErrorMessage ?? 'The create call failed.',
      code: local.createErrorCode ?? undefined
    }
  }
  if (isTerminal(local.status)) {
    return { ok: true, status: local.status, terminal: true }
  }

  try {
    let application: Application

    if (!local.joboApplicationId) {
      // Stuck in `creating`: the original blocking create is still held (or
      // the process died mid-hold). Replaying create with the SAME stored
      // Idempotency-Key re-attaches to the in-flight application and its
      // wait — this is why the key was written before the first attempt.
      application = await jobo().applications.create(
        { apply_url: local.applyUrl },
        { idempotencyKey: local.idempotencyKey }
      )
    } else {
      // Long-poll only while Jobo is working; a plain snapshot suffices when
      // the local state says a step is already waiting for answers.
      const working = local.status === 'queued' || local.status === 'running'
      application = await jobo().applications.get(
        local.joboApplicationId,
        working ? { waitSeconds: MAX_WAIT_SECONDS } : undefined
      )
    }

    persistApplication(id, application)

    if (application.status === 'awaiting_answers' && application.current_step) {
      application = await answerStep(local, application, application.current_step)
      persistApplication(id, application)
    }

    revalidatePath(`/applications/${id}`)
    revalidatePath('/learn')

    const step = application.status === 'awaiting_answers' ? application.current_step : null
    return {
      ok: true,
      status: application.status,
      terminal: isTerminal(application.status),
      stepSequence: step?.sequence,
      correctionRound: step?.correction_round
    }
  } catch (error) {
    const message = explain(error)
    const code = error instanceof JoboAPIError ? error.code : 'network_error'
    log.warn({ id, code, message }, 'advance failed')
    revalidatePath(`/applications/${id}`)
    return { ok: false, status: local.status, terminal: false, error: message, code }
  }
}

/**
 * Answer the current step: run the answer engine, submit, and if the server's
 * free validation refuses the snapshot, repair from its per-field errors and
 * retry once. Returns whatever state the blocking submit resolved to — the
 * next step, a correction round, or the terminal result.
 */
async function answerStep(
  local: ApplicationRow,
  application: Application,
  step: ApplicationStep
): Promise<Application> {
  const startedAt = Date.now()
  const joboId = application.id

  // If this exact round was already submitted (a second tab, a retried browser
  // request), do not answer it again — just re-attach to the wait.
  const existing = db
    .select()
    .from(steps)
    .where(and(eq(steps.stepId, step.id), eq(steps.correctionRound, step.correction_round)))
    .get()
  if (existing?.submittedAt) {
    return jobo().applications.get(joboId, { waitSeconds: MAX_WAIT_SECONDS })
  }

  const completeStep = (
    values: Partial<typeof steps.$inferInsert> & { status: string }
  ) =>
    db.update(steps)
      .set({ ...values, totalMs: Date.now() - startedAt })
      .where(and(eq(steps.stepId, step.id), eq(steps.correctionRound, step.correction_round)))
      .run()

  const cancelCleanly = async (
    reason: string,
    extra: Partial<typeof steps.$inferInsert> = {}
  ): Promise<Application> => {
    log.warn({ id: local.id, step: step.sequence, reason }, 'canceling application')
    completeStep({ status: 'canceled', error: reason, ...extra })
    await jobo().applications.cancel(joboId)
    // Cancels settle at the next safe checkpoint; wait for the terminal state.
    return jobo().applications.get(joboId, { waitSeconds: MAX_WAIT_SECONDS })
  }

  const profile = db.select().from(profiles).where(eq(profiles.id, local.profileId)).get()
  if (!profile) return cancelCleanly('profile deleted')

  // The previous round's accepted answers, from our own audit table, so a
  // correction re-sends a complete snapshot instead of a delta (the full field
  // list comes back every round).
  const previousAnswers =
    step.correction_round > 0
      ? (db
          .select()
          .from(steps)
          .where(and(eq(steps.stepId, step.id), eq(steps.correctionRound, step.correction_round - 1)))
          .get()?.answersJson ?? [])
      : []

  // The budget is derived from the step deadline: a real browser is holding
  // the employer's form open until answers_expire_at (~3 minutes; 60s for
  // one-time codes), and missing it fails the application with answers_timeout.
  const expiresAt = step.answers_expire_at ? Date.parse(step.answers_expire_at) : Number.NaN
  const remaining = Number.isFinite(expiresAt) ? expiresAt - Date.now() : config().ANSWER_BUDGET_MS
  const budgetMs = Math.min(Math.max(remaining - RESERVE_MS, 0), config().ANSWER_BUDGET_MS)

  const ctx: AnswerContext = {
    profile: profile.data,
    eeo: profile.eeo ?? emptyEeo,
    // File fields need a public HTTPS URL Jobo can download the resume from.
    // Without PUBLIC_BASE_URL the engine skips them and records a trace note.
    resumeUrl: config().PUBLIC_BASE_URL ? signResumeUrl(profile.id) : null,
    resumeFilename: profile.resumeFilename,
    resumeContentType: profile.resumeContentType,
    resumeText: profile.resumeText,
    applyUrl: local.applyUrl,
    providerName: application.provider_name ?? undefined,
    commandErrors: step.command_errors ?? [],
    correctionRound: step.correction_round,
    previousAnswers,
    budgetMs
  }

  log.info(
    {
      id: local.id,
      step: step.sequence,
      correctionRound: step.correction_round,
      fields: step.fields.length,
      budgetMs
    },
    'generating answers'
  )

  const result = await buildAnswers(step.fields, ctx)

  if (result.unanswerable.length > 0) {
    // A clean cancel beats an incomplete submit. The server would refuse the
    // snapshot with per-field `required` errors — free, but no closer to
    // submitted, and the step deadline keeps running meanwhile.
    completeStep({
      status: 'canceled',
      trace: result.trace,
      llmModel: result.llmModel ?? null,
      llmMs: result.llmMs ?? null,
      error: `required fields could not be answered: ${result.unanswerable
        .map((f) => f.label)
        .join(', ')}`
    })
    await jobo().applications.cancel(joboId)
    return jobo().applications.get(joboId, { waitSeconds: MAX_WAIT_SECONDS })
  }

  let answers = result.answers
  try {
    // The one write in the loop. Validated synchronously (a 400 here is free),
    // then BLOCKS while Jobo fills the form and clicks through — the response
    // is the next step, a correction round, or the terminal application.
    return await submitAndRecord()
  } catch (error) {
    if (!(error instanceof JoboValidationError)) throw error

    // Free per-field validation errors: nothing was consumed, no correction
    // round burned. Repair mechanically from the server's own error list and
    // retry once; a snapshot that cannot be repaired will never be accepted,
    // so cancel cleanly rather than looping.
    const repaired = repairAnswers(answers, error.errors, step.fields, result.trace)
    if (!repaired) {
      return cancelCleanly(
        `validation failed and nothing was repairable: ${summarize(error.errors)}`,
        { trace: result.trace, llmModel: result.llmModel ?? null, llmMs: result.llmMs ?? null }
      )
    }
    answers = repaired
    try {
      return await submitAndRecord()
    } catch (secondError) {
      if (!(secondError instanceof JoboValidationError)) throw secondError
      return cancelCleanly(
        `validation failed after one repair pass: ${summarize(secondError.errors)}`,
        { trace: result.trace, llmModel: result.llmModel ?? null, llmMs: result.llmMs ?? null }
      )
    }
  }

  async function submitAndRecord(): Promise<Application> {
    const next = await jobo().applications.submitAnswers(joboId, answers, {
      // Optimistic guard: refuse to answer a different round than the one this
      // snapshot was built for (409 stale_correction_round on mismatch).
      correctionRound: step.correction_round
    })
    completeStep({
      status: 'submitted',
      answersJson: answers,
      trace: result.trace,
      llmModel: result.llmModel ?? null,
      llmMs: result.llmMs ?? null,
      error: result.llmError ?? null,
      submittedAt: Date.now()
    })
    log.info(
      {
        id: local.id,
        step: step.sequence,
        correctionRound: step.correction_round,
        answered: answers.length,
        llmMs: result.llmMs,
        nextStatus: next.status
      },
      'answers accepted'
    )
    return next
  }
}

/**
 * Mirror the authoritative application state into the local rows: the
 * application itself, and — when a step is awaiting answers — the receipt of
 * that step round in the audit table. Recording the receipt here means the
 * audit trail shows every round that ARRIVED, even if answering it later
 * fails, and it is what makes the create response's fields visible in the UI
 * before the first advance runs.
 */
function persistApplication(localId: string, application: Application): void {
  db.update(applications)
    .set({
      joboApplicationId: application.id,
      status: application.status,
      providerId: application.provider_id,
      providerName: application.provider_name,
      failureCode: application.failure?.code ?? null,
      failureMessage: application.failure?.message ?? null,
      failureRetryable: application.failure?.retryable ?? null,
      lastSyncedAt: Date.now(),
      updatedAt: Date.now()
    })
    .where(eq(applications.id, localId))
    .run()

  const step = application.status === 'awaiting_answers' ? application.current_step : null
  if (step) {
    db.insert(steps)
      .values({
        stepId: step.id,
        correctionRound: step.correction_round,
        applicationId: localId,
        sequence: step.sequence,
        fieldsJson: step.fields,
        commandErrorsJson: step.command_errors,
        status: 'answering'
      })
      .onConflictDoNothing()
      .run()
  }
}

export async function cancelApplicationAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const local = db.select().from(applications).where(eq(applications.id, id)).get()
  if (!local?.joboApplicationId) return { ok: false, error: 'This application was never created.' }

  try {
    const summary = await jobo().applications.cancel(local.joboApplicationId)
    db.update(applications)
      .set({ status: summary.status, lastSyncedAt: Date.now(), updatedAt: Date.now() })
      .where(eq(applications.id, id))
      .run()
    revalidatePath(`/applications/${id}`)
    return { ok: true }
  } catch (error) {
    const message = explain(error)
    return { ok: false, error: message }
  }
}

/**
 * Pull a plain snapshot from Jobo — no long-poll, no answering. The advance
 * loop is the primary driver; this covers a page opened mid-flight or the
 * manual Sync button.
 */
export async function syncApplicationAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const local = db.select().from(applications).where(eq(applications.id, id)).get()
  if (!local?.joboApplicationId) return { ok: false, error: 'Nothing to sync.' }

  try {
    const detail = await jobo().applications.get(local.joboApplicationId)
    persistApplication(id, detail)
    revalidatePath(`/applications/${id}`)
    return { ok: true }
  } catch (error) {
    const message = explain(error)
    return { ok: false, error: message }
  }
}

/** Server-side helper for the detail page: refresh if stale and still open. */
export async function refreshIfStale(id: string, maxAgeMs = 3_000): Promise<void> {
  const local = db.select().from(applications).where(eq(applications.id, id)).get()
  if (!local?.joboApplicationId) return
  if (isTerminal(local.status)) return
  if (local.lastSyncedAt && Date.now() - local.lastSyncedAt < maxAgeMs) return
  await syncApplicationAction(id)
}

function summarize(errors: { field_id: string | null; code: string }[]): string {
  return errors
    .slice(0, 5)
    .map((e) => `${e.field_id ?? '(request)'}: ${e.code}`)
    .join(', ')
}
