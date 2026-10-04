import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { applications, steps, type ApplicationRow } from '@/db/schema'
import { config } from '@/lib/config'
import {
  JoboValidationError,
  JoboAPIError,
  type Application,
  type ApplicationStep,
} from '@jobo-ai/autoapply'
import { jobo } from '@/lib/jobo/client'
import { environmentForKey } from '@/lib/jobo/environment'
import { buildAnswers, repairAnswers } from '@/lib/answers'
import type { AnswerContext, BuildResult } from '@/lib/answers/types'
import { signApplicationResumeUrl } from '@/lib/signed-url'
import { isTerminal } from '@/lib/status'
import { openApiKey } from '@/lib/user-settings'
import { log } from '@/lib/logger'
import { createFailureMessage } from '@/lib/presentation'
import { assertLease, updateLeased } from '@/lib/queue'

/**
 * The Auto Apply loop, driven one step per worker claim.
 *
 * Auto Apply is synchronous: every call blocks until there is something for
 * this app to do, and the response IS the next state. One application goes:
 *
 *   1. create   `applications.create({ job_id }, { idempotencyKey })`
 *               blocks until Jobo has opened the form and discovered the first
 *               step's fields. The idempotency key was stored at enqueue, so
 *               replaying create after a crash or timeout re-attaches to the
 *               same application instead of starting a second one.
 *   2. answer   the step comes back as `status: awaiting_answers` with
 *               `current_step.fields`. lib/answers builds a complete answer
 *               snapshot (deterministic rules first, one model call for the
 *               rest), it is stored, then `submitAnswers` sends it. A 400
 *               JoboValidationError costs nothing: we repair once from the
 *               per-field errors and resend.
 *   3. advance  `submitAnswers` blocks while Jobo fills the form and resolves
 *               to the next step, a correction round (the same step with
 *               `correction_round + 1` and the ATS's `command_errors`), or a
 *               terminal application: submitted, failed or canceled.
 *
 * Any blocking call may instead return a 202 snapshot that is still `queued`
 * or `running` (Jobo holds a request for at most ~9 minutes). This engine just
 * stores it and returns; the next claim re-attaches with
 * `applications.get(id, { waitSeconds })`, which long-polls until the
 * application is answerable or terminal. The same call recovers from a
 * dropped connection or a restarted worker.
 *
 * The SDK also offers `applications.run()`, which drives this whole loop in
 * one call. A web app cannot use it as-is: a run takes minutes, must survive
 * restarts, and needs every answer persisted before it is sent. So the loop is
 * unrolled here and each call's result is written to Postgres first.
 *
 * Not handled: `one_time_code` fields (an emailed verification code). The
 * application is canceled with an explanation. The SDK's `mailboxes` resource
 * can fetch such codes if you connect the candidate's inbox.
 */

/** Time kept back from a step's answer deadline for the submit request itself. */
const DEADLINE_RESERVE_MS = 20_000
/** Long-poll length for `applications.get`, in seconds. */
const MAX_WAIT_SECONDS = 90
/** Snapshot reads, and the pause between them, while a cancel settles. */
const CANCEL_POLLS = 5
const CANCEL_POLL_MS = 500
/**
 * Jobo honours an Idempotency-Key for 24 hours. A create still unconfirmed
 * after 20 is given up rather than replayed into a window where the key may
 * have expired and the replay could start a second application.
 */
const IDEMPOTENCY_RECOVERY_WINDOW_MS = 20 * 60 * 60 * 1000

class MissingApiKeyError extends Error {
  constructor() {
    super(
      'The Jobo API key for this application is no longer available. Reconnect your key and retry.',
    )
    this.name = 'MissingApiKeyError'
  }
}

/**
 * The client for one application, from its row alone: the visitor may have
 * replaced their key or closed the tab since. Every run uses the visitor's
 * own key, sealed on the row when it was queued, so the application lives in
 * THEIR Jobo account, sandbox or production.
 */
function clientFor(local: Pick<ApplicationRow, 'id' | 'apiKeyCiphertext'>) {
  if (!local.apiKeyCiphertext) throw new MissingApiKeyError()
  let apiKey: string
  try {
    apiKey = openApiKey(local.apiKeyCiphertext)
  } catch {
    throw new MissingApiKeyError()
  }
  return jobo(environmentForKey(apiKey), local.id)
}

async function readApplication(id: string): Promise<ApplicationRow | undefined> {
  const [row] = await db.select().from(applications).where(eq(applications.id, id)).limit(1)
  return row
}

/**
 * Advance one application by one blocking exchange. Called by a worker that
 * holds the row's lease; returns when the state has been persisted. Errors
 * that a retry might fix are thrown (the worker backs off and retries);
 * conditions no retry can fix stop the run here with an explanation.
 */
export async function advanceApplication(id: string, leaseOwner: string): Promise<void> {
  const local = await readApplication(id)
  if (!local || isTerminal(local.status)) return
  await assertLease(id, leaseOwner)
  const stop = (values: Partial<typeof applications.$inferInsert>) =>
    updateLeased(id, leaseOwner, { apiKeyCiphertext: null, updatedAt: Date.now(), ...values })

  let api: ReturnType<typeof jobo>
  try {
    api = clientFor(local)
  } catch (error) {
    if (!(error instanceof MissingApiKeyError)) throw error
    // No retry can succeed without the key. Before create, nothing happened
    // upstream; after it, Jobo may still be running the application, and
    // only the key's owner can see its outcome now.
    return stop(
      local.joboApplicationId
        ? {
            status: 'recovery_required',
            stopReason:
              'The Jobo API key this application ran on is no longer available, so its final status cannot be checked here. See the applications in your Jobo dashboard.',
          }
        : { status: 'create_failed', stopReason: error.message, failureMessage: error.message },
    )
  }

  if (!local.joboApplicationId && Date.now() - local.createdAt > IDEMPOTENCY_RECOVERY_WINDOW_MS)
    return stop({
      status: 'recovery_required',
      cancelRequested: true,
      stopReason:
        'We could not confirm whether this application started. It is paused for review to prevent a duplicate submission.',
    })

  try {
    let application: Application
    if (!local.joboApplicationId) {
      // First attempt, or a replay after a timeout or crash: the same stored
      // Idempotency-Key re-attaches to the application Jobo already started.
      // Created by Jobo job id in both modes; Jobo resolves the ATS and the
      // apply URL from its own record of that job.
      application = await api.applications.create(
        { job_id: local.jobId },
        { idempotencyKey: local.idempotencyKey },
      )
    } else {
      // Long-poll only while Jobo is working; a plain snapshot suffices when
      // the local state says a step is already waiting for answers.
      const working = local.status === 'queued' || local.status === 'running'
      application = await api.applications.get(
        local.joboApplicationId,
        working ? { waitSeconds: MAX_WAIT_SECONDS } : undefined,
      )
    }
    await persistApplication(id, application, leaseOwner)

    const fresh = await readApplication(id)
    if (!fresh) return
    if (fresh.cancelRequested && !isTerminal(application.status)) {
      await assertLease(id, leaseOwner)
      await api.applications.cancel(application.id)
      application = await awaitCancel(api, application.id)
      await persistApplication(id, application, leaseOwner)
      return
    }
    if (application.status === 'awaiting_answers' && application.current_step) {
      application = await answerStep(fresh, application, application.current_step, leaseOwner)
      await persistApplication(id, application, leaseOwner)
    }
  } catch (error) {
    // A definitive intake refusal (4xx other than timeout/conflict/rate limit)
    // created no application. A lost response is different: leave its key
    // intact for reconciliation, never start over.
    if (
      !local.joboApplicationId &&
      error instanceof JoboAPIError &&
      error.status >= 400 &&
      error.status < 500 &&
      ![408, 409, 429].includes(error.status) &&
      !(await readApplication(id))?.joboApplicationId
    )
      return stop({
        status: 'create_failed',
        createErrorCode: error.code,
        createErrorDetail: error.detail || null,
        failureMessage: createFailureMessage(error.code, {
          sandbox: local.sandbox,
          detail: error.detail,
        }),
      })
    throw error
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
  step: ApplicationStep,
  leaseOwner: string,
): Promise<Application> {
  const startedAt = Date.now()
  const joboId = application.id
  const api = clientFor(local)
  const thisRound = and(eq(steps.stepId, step.id), eq(steps.correctionRound, step.correction_round))

  // If this exact round was already submitted (the response was lost, or the
  // worker restarted), do not answer it again — just re-attach to the wait.
  const [existing] = await db.select().from(steps).where(thisRound).limit(1)
  if (existing?.submittedAt) return api.applications.get(joboId, { waitSeconds: MAX_WAIT_SECONDS })

  const completeStep = async (values: Partial<typeof steps.$inferInsert> & { status: string }) => {
    await assertLease(local.id, leaseOwner)
    await db
      .update(steps)
      .set({ ...values, totalMs: Date.now() - startedAt })
      .where(thisRound)
  }

  // Stop this application on purpose, recording why (and, once answers were
  // built, how) on the step row.
  const cancelCleanly = async (reason: string, built?: BuildResult): Promise<Application> => {
    log.warn({ id: local.id, step: step.sequence, reason }, 'canceling application')
    await completeStep({ status: 'canceled', error: reason, ...traceOf(built) })
    await updateLeased(local.id, leaseOwner, { stopReason: reason, cancelRequested: true })
    await api.applications.cancel(joboId)
    return awaitCancel(api, joboId)
  }

  if (step.fields.some((f) => f.format === 'one_time_code'))
    return cancelCleanly(
      'This application requires a verification code and cannot be completed hands-free.',
    )

  // The previous round's accepted answers, from our own audit table, so a
  // correction re-sends a complete snapshot instead of a delta (the full field
  // list comes back every round).
  const previousAnswers =
    step.correction_round > 0
      ? ((
          await db
            .select()
            .from(steps)
            .where(
              and(eq(steps.stepId, step.id), eq(steps.correctionRound, step.correction_round - 1)),
            )
            .limit(1)
        )[0]?.answersJson ?? [])
      : []

  // A real browser is holding the employer's form open until
  // answers_expire_at (~5 minutes; 60 s for one-time codes). Most providers
  // keep waiting past it on a fresh browser, but answering inside the window
  // is fastest, so the model gets whatever is left minus a submit reserve.
  const expiresAt = step.answers_expire_at ? Date.parse(step.answers_expire_at) : Number.NaN
  const remaining = Number.isFinite(expiresAt) ? expiresAt - Date.now() : config().ANSWER_BUDGET_MS
  const budgetMs = Math.min(Math.max(remaining - DEADLINE_RESERVE_MS, 0), config().ANSWER_BUDGET_MS)

  const job = local.jobSnapshot
  const profile = local.profileSnapshot
  const ctx: AnswerContext = {
    profile: profile.data,
    // File fields need a public HTTPS URL Jobo can download the resume from.
    // Without PUBLIC_BASE_URL the engine skips them and records a trace note.
    resumeUrl: config().PUBLIC_BASE_URL ? signApplicationResumeUrl(local.id) : null,
    resumeFilename: profile.resumeFilename,
    resumeContentType: profile.resumeContentType,
    resumeText: profile.resumeText,
    jobCountryCode: job.countryCode,
    jobDescription: `${job.role} at ${job.company}\n${job.about}\n${job.responsibilities.join('\n')}`,
    applyUrl: local.applyUrl,
    providerName: application.provider_name ?? undefined,
    commandErrors: step.command_errors ?? [],
    correctionRound: step.correction_round,
    previousAnswers,
    budgetMs,
  }

  log.info(
    {
      id: local.id,
      step: step.sequence,
      correctionRound: step.correction_round,
      fields: step.fields.length,
      budgetMs,
    },
    'generating answers',
  )

  // Persisted before submit: a process restart must replay the identical answers.
  const built: BuildResult = existing?.answersJson
    ? {
        answers: existing.answersJson,
        trace: existing.trace ?? [],
        unanswerable: [],
        llmModel: existing.llmModel ?? undefined,
        llmMs: existing.llmMs ?? undefined,
      }
    : await buildAnswers(step.fields, ctx)

  // A failed model call is not fatal: the deterministic answers may already
  // cover every required field, and Jobo leaves unanswered optional fields
  // alone. Only a refused key stops here, because no retry can succeed.
  if (built.llmFatal)
    return cancelCleanly(
      'The answer service rejected its API key, so no questions could be answered. Please try again later.',
      built,
    )
  if (built.unanswerable.length > 0) {
    const missing = built.unanswerable.map((f) => f.label).join(', ')
    const fumbled = built.modelFailures?.map((f) => f.label).join(', ')
    return cancelCleanly(
      built.llmError
        ? `The AI answer step failed (${built.llmError}), so these required questions have no answer: ${missing}. Please try again.`
        : fumbled
          ? `The AI could not produce a valid answer for: ${fumbled}. Please try again.`
          : `Your profile is missing required information: ${missing}`,
      built,
    )
  }

  let answers = built.answers
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
    const repaired = repairAnswers(answers, error.errors, step.fields, built.trace)
    if (!repaired)
      return cancelCleanly(
        `validation failed and nothing was repairable: ${summarize(error.errors)}`,
        built,
      )
    answers = repaired
    try {
      return await submitAndRecord()
    } catch (secondError) {
      if (!(secondError instanceof JoboValidationError)) throw secondError
      return cancelCleanly(
        `validation failed after one repair pass: ${summarize(secondError.errors)}`,
        built,
      )
    }
  }

  async function submitAndRecord(): Promise<Application> {
    const current = await readApplication(local.id)
    if (current?.cancelRequested) return cancelCleanly('Canceled at your request.', built)
    await completeStep({ status: 'answering', answersJson: answers, ...traceOf(built) })
    const next = await api.applications.submitAnswers(joboId, answers, {
      // Optimistic guard: refuse to answer a different round than the one this
      // snapshot was built for (409 stale_correction_round on mismatch).
      correctionRound: step.correction_round,
    })
    await completeStep({
      status: 'submitted',
      answersJson: answers,
      ...traceOf(built),
      error: built.llmError ?? null,
      submittedAt: Date.now(),
    })
    log.info(
      {
        id: local.id,
        step: step.sequence,
        correctionRound: step.correction_round,
        answered: answers.length,
        llmMs: built.llmMs,
        nextStatus: next.status,
      },
      'answers accepted',
    )
    return next
  }
}

/**
 * Wait for a requested cancel to reach its terminal state. Cancels settle at
 * the next safe checkpoint. A running application long-polls there directly,
 * but one awaiting answers already counts as answerable, so the long poll
 * returns at once until the cancel lands: poll briefly instead. Still not
 * terminal after that, the snapshot is returned and the next claim checks again.
 */
async function awaitCancel(api: ReturnType<typeof jobo>, joboId: string): Promise<Application> {
  for (let attempt = 1; ; attempt++) {
    const application = await api.applications.get(joboId, { waitSeconds: MAX_WAIT_SECONDS })
    if (isTerminal(application.status) || attempt >= CANCEL_POLLS) return application
    if (application.status === 'awaiting_answers')
      await new Promise((resolve) => setTimeout(resolve, CANCEL_POLL_MS))
  }
}

/**
 * Mirror the authoritative application state into the local rows: the
 * application itself, and — when a step is awaiting answers — the receipt of
 * that step round in the audit table. Recording the receipt here means the
 * audit trail shows every round that ARRIVED, even if answering it later
 * fails, and it is what makes the create response's fields visible in the UI
 * before the first answer is built.
 */
async function persistApplication(
  localId: string,
  application: Application,
  leaseOwner: string,
): Promise<void> {
  await updateLeased(localId, leaseOwner, {
    joboApplicationId: application.id,
    status: application.status,
    providerId: application.provider_id,
    providerName: application.provider_name,
    failureCode: application.failure?.code ?? null,
    failureMessage: application.failure?.message ?? null,
    failureRetryable: application.failure?.retryable ?? null,
    // A finished run never needs the visitor's key again.
    ...(isTerminal(application.status) ? { apiKeyCiphertext: null } : {}),
    lastSyncedAt: Date.now(),
    updatedAt: Date.now(),
  })

  const step = application.status === 'awaiting_answers' ? application.current_step : null
  if (step) {
    await db
      .insert(steps)
      .values({
        stepId: step.id,
        correctionRound: step.correction_round,
        applicationId: localId,
        sequence: step.sequence,
        fieldsJson: step.fields,
        commandErrorsJson: step.command_errors,
        status: 'answering',
      })
      .onConflictDoNothing()
  }
}

/** The answer engine's provenance columns for a step row. */
function traceOf(built?: BuildResult) {
  return built
    ? { trace: built.trace, llmModel: built.llmModel ?? null, llmMs: built.llmMs ?? null }
    : {}
}

function summarize(errors: { field_id: string | null; code: string }[]): string {
  return errors
    .slice(0, 5)
    .map((e) => `${e.field_id ?? '(request)'}: ${e.code}`)
    .join(', ')
}
