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
import { buildAnswers, repairAnswers } from '@/lib/answers'
import type { AnswerContext, BuildResult } from '@/lib/answers/types'
import { signApplicationResumeUrl } from '@/lib/signed-url'
import { isTerminal } from '@/lib/status'
import { jobCountryCode, validProductionTarget, validSandboxUrl } from '@/lib/jobs'
import { openApiKey } from '@/lib/user-settings'
import { log } from '@/lib/logger'
import { createFailureMessage } from '@/lib/presentation'
const RESERVE_MS = 20000
const MAX_WAIT_SECONDS = 90

/**
 * The client for one application. Sandbox runs use the deployment's key;
 * production runs use the visitor's own key, sealed on the row when it was
 * queued, so the application lives in THEIR Jobo account.
 */
function clientFor(local: Pick<ApplicationRow, 'id' | 'sandbox' | 'apiKeyCiphertext'>) {
  if (local.sandbox) return jobo(local.id)
  if (!local.apiKeyCiphertext) throw new MissingApiKeyError()
  let apiKey: string
  try {
    apiKey = openApiKey(local.apiKeyCiphertext)
  } catch {
    throw new MissingApiKeyError()
  }
  return jobo(local.id, apiKey)
}

class MissingApiKeyError extends Error {
  constructor() {
    super('The Jobo API key for this application is no longer available. Reconnect your key and retry.')
    this.name = 'MissingApiKeyError'
  }
}
async function assertLease(id: string, owner: string) {
  const [row] = await db
    .select()
    .from(applications)
    .where(eq(applications.id, id))
    .limit(1)
  if (row?.leaseOwner !== owner || (row.leaseUntil ?? 0) <= Date.now())
    throw new Error('Application lease lost')
}
export async function advanceApplication(
  id: string,
  leaseOwner: string,
): Promise<void> {
  const [local] = await db
    .select()
    .from(applications)
    .where(eq(applications.id, id))
    .limit(1)
  if (
    !local ||
    !local.userId ||
    !local.profileSnapshot ||
    !local.jobSnapshot ||
    isTerminal(local.status)
  )
    return
  await assertLease(id, leaseOwner)
  if (local.sandbox) {
    if (!validSandboxUrl(local.applyUrl, local.jobId ?? ''))
      throw new Error('Application destination is not in the sandbox.')
  } else if (!validProductionTarget(local.jobId ?? '', local.applyUrl))
    throw new Error('Application destination is not a Jobo job.')
  let api: ReturnType<typeof jobo>
  try {
    api = clientFor(local)
  } catch (error) {
    if (!(error instanceof MissingApiKeyError)) throw error
    // No retry can succeed without the key: stop instead of looping.
    await db
      .update(applications)
      .set({
        status: local.joboApplicationId ? 'failed' : 'create_failed',
        stopReason: error.message,
        failureMessage: error.message,
        apiKeyCiphertext: null,
        updatedAt: Date.now(),
      })
      .where(eq(applications.id, id))
    return
  }
  if (
    !local.joboApplicationId &&
    Date.now() - local.createdAt > 20 * 60 * 60 * 1000
  )
    throw new Error(
      'Creation could not be reconciled within the idempotency window. No new submission was attempted.',
    )
  try {
    let application: Application

    if (!local.joboApplicationId) {
      // Stuck in `creating`: the original blocking create is still held (or
      // the process died mid-hold). Replaying create with the SAME stored
      // Idempotency-Key re-attaches to the in-flight application and its
      // wait — this is why the key was written before the first attempt.
      // Production runs create by Jobo job id: Jobo resolves the ATS and the
      // apply URL from its own catalog record of that job.
      application = await api.applications.create(
        local.sandbox ? { apply_url: local.applyUrl } : { job_id: local.jobId! },
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

    const [fresh] = await db
      .select()
      .from(applications)
      .where(eq(applications.id, id))
      .limit(1)
    if (fresh!.cancelRequested && !isTerminal(application.status)) {
      await assertLease(id, leaseOwner)
      await api.applications.cancel(application.id)
      application = await api.applications.get(application.id, {
        waitSeconds: MAX_WAIT_SECONDS,
      })
      await persistApplication(id, application, leaseOwner)
      return
    }
    if (application.status === 'awaiting_answers' && application.current_step) {
      application = await answerStep(
        local,
        application,
        application.current_step,
        leaseOwner,
      )
      await persistApplication(id, application, leaseOwner)
    }
  } catch (error) {
    // A definitive intake refusal created no application. A lost response is
    // different: leave its key intact for reconciliation, never start over.
    if (
      !local.joboApplicationId &&
      error instanceof JoboAPIError &&
      error.status >= 400 &&
      error.status < 500 &&
      ![408, 409, 429].includes(error.status)
    ) {
      await assertLease(id, leaseOwner)
      const [current] = await db
        .select()
        .from(applications)
        .where(eq(applications.id, id))
        .limit(1)
      if (!current?.joboApplicationId) {
        await db
          .update(applications)
          .set({
            status: 'create_failed',
            createErrorCode: error.code,
            apiKeyCiphertext: null,
            failureMessage: createFailureMessage(error.code),
            updatedAt: Date.now(),
          })
          .where(eq(applications.id, id))
        return
      }
    }
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

  // If this exact round was already submitted (a second tab, a retried browser
  // request), do not answer it again — just re-attach to the wait.
  const [existing] = await db
    .select()
    .from(steps)
    .where(
      and(
        eq(steps.stepId, step.id),
        eq(steps.correctionRound, step.correction_round),
      ),
    )
    .limit(1)
  if (existing?.submittedAt) {
    return clientFor(local).applications.get(joboId, { waitSeconds: MAX_WAIT_SECONDS })
  }

  const completeStep = async (
    values: Partial<typeof steps.$inferInsert> & { status: string },
  ) => {
    await assertLease(local.id, leaseOwner)
    await db
      .update(steps)
      .set({ ...values, totalMs: Date.now() - startedAt })
      .where(
        and(
          eq(steps.stepId, step.id),
          eq(steps.correctionRound, step.correction_round),
        ),
      )
  }

  const cancelCleanly = async (
    reason: string,
    extra: Partial<typeof steps.$inferInsert> = {},
  ): Promise<Application> => {
    log.warn(
      { id: local.id, step: step.sequence, reason },
      'canceling application',
    )
    await completeStep({ status: 'canceled', error: reason, ...extra })
    await db
      .update(applications)
      .set({ stopReason: reason, cancelRequested: true })
      .where(eq(applications.id, local.id))
    await clientFor(local).applications.cancel(joboId)
    // Cancels settle at the next safe checkpoint; wait for the terminal state.
    return clientFor(local).applications.get(joboId, { waitSeconds: MAX_WAIT_SECONDS })
  }

  const profile = local.profileSnapshot
  if (!profile) return cancelCleanly('The saved profile is unavailable.')
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
              and(
                eq(steps.stepId, step.id),
                eq(steps.correctionRound, step.correction_round - 1),
              ),
            )
            .limit(1)
        )[0]?.answersJson ?? [])
      : []

  // The budget is derived from the step deadline: a real browser is holding
  // the employer's form open until answers_expire_at (~3 minutes; 60s for
  // one-time codes), and missing it fails the application with answers_timeout.
  const expiresAt = step.answers_expire_at
    ? Date.parse(step.answers_expire_at)
    : Number.NaN
  const remaining = Number.isFinite(expiresAt)
    ? expiresAt - Date.now()
    : config().ANSWER_BUDGET_MS
  const budgetMs = Math.min(
    Math.max(remaining - RESERVE_MS, 0),
    config().ANSWER_BUDGET_MS,
  )

  const ctx: AnswerContext = {
    profile: profile.data,
    // File fields need a public HTTPS URL Jobo can download the resume from.
    // Without PUBLIC_BASE_URL the engine skips them and records a trace note.
    resumeUrl: config().PUBLIC_BASE_URL
      ? signApplicationResumeUrl(local.id)
      : null,
    resumeFilename: profile.resumeFilename,
    resumeContentType: profile.resumeContentType,
    resumeText: profile.resumeText,
    jobCountryCode: local.jobSnapshot
      ? (local.jobSnapshot.countryCode ?? jobCountryCode(local.jobSnapshot.location))
      : undefined,
    jobDescription: local.jobSnapshot
      ? `${local.jobSnapshot.role} at ${local.jobSnapshot.company}\n${local.jobSnapshot.about}\n${local.jobSnapshot.responsibilities.join('\n')}`
      : undefined,
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
  const result: BuildResult = existing?.answersJson
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
  const traceExtras = {
    trace: result.trace,
    llmModel: result.llmModel ?? null,
    llmMs: result.llmMs ?? null,
  }
  if (result.llmFatal)
    return cancelCleanly(
      'The answer service rejected its API key, so no questions could be answered. Please try again later.',
      traceExtras,
    )
  if (result.unanswerable.length > 0) {
    const missing = result.unanswerable.map((f) => f.label).join(', ')
    return cancelCleanly(
      result.llmError
        ? `The AI answer step failed (${result.llmError}), so these required questions have no answer: ${missing}. Please try again.`
        : `Your profile is missing required information: ${missing}`,
      traceExtras,
    )
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
    const repaired = repairAnswers(
      answers,
      error.errors,
      step.fields,
      result.trace,
    )
    if (!repaired) {
      return cancelCleanly(
        `validation failed and nothing was repairable: ${summarize(error.errors)}`,
        {
          trace: result.trace,
          llmModel: result.llmModel ?? null,
          llmMs: result.llmMs ?? null,
        },
      )
    }
    answers = repaired
    try {
      return await submitAndRecord()
    } catch (secondError) {
      if (!(secondError instanceof JoboValidationError)) throw secondError
      return cancelCleanly(
        `validation failed after one repair pass: ${summarize(secondError.errors)}`,
        {
          trace: result.trace,
          llmModel: result.llmModel ?? null,
          llmMs: result.llmMs ?? null,
        },
      )
    }
  }

  async function submitAndRecord(): Promise<Application> {
    await assertLease(local.id, leaseOwner)
    const [current] = await db
      .select()
      .from(applications)
      .where(eq(applications.id, local.id))
      .limit(1)
    if (current?.cancelRequested) {
      return cancelCleanly('Canceled at your request.')
    }
    await completeStep({
      status: 'answering',
      answersJson: answers,
      trace: result.trace,
      llmModel: result.llmModel ?? null,
      llmMs: result.llmMs ?? null,
    })
    const next = await clientFor(local).applications.submitAnswers(joboId, answers, {
      // Optimistic guard: refuse to answer a different round than the one this
      // snapshot was built for (409 stale_correction_round on mismatch).
      correctionRound: step.correction_round,
    })
    await completeStep({
      status: 'submitted',
      answersJson: answers,
      trace: result.trace,
      llmModel: result.llmModel ?? null,
      llmMs: result.llmMs ?? null,
      error: result.llmError ?? null,
      submittedAt: Date.now(),
    })
    log.info(
      {
        id: local.id,
        step: step.sequence,
        correctionRound: step.correction_round,
        answered: answers.length,
        llmMs: result.llmMs,
        nextStatus: next.status,
      },
      'answers accepted',
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
async function persistApplication(
  localId: string,
  application: Application,
  leaseOwner: string,
): Promise<void> {
  await assertLease(localId, leaseOwner)
  await db
    .update(applications)
    .set({
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
    .where(eq(applications.id, localId))

  const step =
    application.status === 'awaiting_answers' ? application.current_step : null
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

function summarize(
  errors: { field_id: string | null; code: string }[],
): string {
  return errors
    .slice(0, 5)
    .map((e) => `${e.field_id ?? '(request)'}: ${e.code}`)
    .join(', ')
}
