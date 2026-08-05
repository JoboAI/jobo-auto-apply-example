import { cancel, createCallbackHandler, type CallbackContext } from '@jobo-ai/autoapply/next'
import type {
  AnswerCommand,
  CanceledEvent,
  FailedEvent,
  FieldsRequestedEvent,
  SubmittedEvent
} from '@jobo-ai/autoapply'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { applications, profiles } from '@/db/schema'
import { buildCommand } from '@/lib/answers'
import { config } from '@/lib/config'
import { awaitResponse, claimEvent, completeEvent, trackInflight } from '@/lib/dedupe'
import { jobo } from '@/lib/jobo/client'
import { log } from '@/lib/logger'
import { emptyEeo } from '@/lib/resume/profile-schema'
import { signResumeUrl } from '@/lib/signed-url'
import type { AnswerContext } from '@/lib/answers/types'

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  THE CENTREPIECE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Everything interesting about integrating Auto Apply happens in this file.
 *
 * Auto Apply is profileless: Jobo stores no candidate data and generates no
 * answers. When its browser agent finds a form it POSTs the fields here, and
 * reads the answers out of THIS RESPONSE BODY, synchronously. There is no
 * "submit answers" endpoint to call later — if this handler does not answer,
 * nothing does.
 *
 * `createCallbackHandler` from `@jobo-ai/autoapply` does the mechanical half:
 * it reads the raw bytes, verifies the HMAC signature against the ±5 minute
 * timestamp window, parses the event, and serialises whatever command you
 * return. What is left below is the part that is genuinely yours.
 *
 * Four rules, each of which costs a real application to learn the hard way:
 *
 *  1. NEVER RETURN A NON-2xx. This inverts the usual webhook instinct. A
 *     non-2xx is not retried — it fails the application immediately with
 *     `callback_rejected`. The 0s/5s/20s retries fire only for *transport*
 *     errors (connection refused, DNS failure, timeout). THE SDK RETURNS 500
 *     IF YOUR HOOK THROWS, so every hook below catches its own failures and
 *     returns `cancel()`: the application ends as `canceled` rather than
 *     `failed` and you keep a clean audit trail.
 *
 *  2. THE CLOCK STARTS AT `created_at`, NOT AT ARRIVAL. The deadline is an
 *     absolute 120 seconds from event creation and covers every transport
 *     attempt. On the t=20s retry you have ~100s left, not 120s.
 *
 *  3. HASH THE RAW BODY. The SDK does this for you, and hands the exact bytes
 *     back on `context.raw` — store those, not a re-serialised event. Parsing
 *     and re-serialising will not round-trip, and Jobo rewrites `attempt` into
 *     the body between retries, so the bytes genuinely differ each time.
 *
 *  4. DEDUPE ON `context.eventId`. It is stable across retries;
 *     `context.attempt` is not.
 */

export const runtime = 'nodejs'
/** The contract allows up to 120s. Do not let the platform cut us off first. */
export const maxDuration = 120
export const dynamic = 'force-dynamic'

/** Absolute, from the event's `created_at`. Not configurable — it is Jobo's. */
const CALLBACK_DEADLINE_MS = 120_000

/**
 * Held back from the LLM budget for validation, persistence, serialisation, and
 * — easy to forget — Jobo's own download of the resume file afterwards, which
 * happens inside the same window.
 */
const RESERVE_MS = 15_000

const decoder = new TextDecoder()

/**
 * Built on first request, not at module scope.
 *
 * `createCallbackHandler({ secret: config().JOBO_WEBHOOK_SECRET })` as a
 * top-level `export const POST` reads perfectly and breaks `next build`:
 * collecting page data imports every route, `config()` throws on a missing
 * env, and the build fails before it can tell you why. Reading straight from
 * `process.env` would not throw — this app validates instead, so it defers.
 */
let handler: ((request: Request) => Promise<Response>) | null = null

export function POST(request: Request): Promise<Response> {
  handler ??= buildHandler()
  return handler(request)
}

const buildHandler = () => createCallbackHandler({
  // One secret, not two. During a rotation Jobo signs with both the current
  // and the previous secret and sends two `v1=` entries, so whichever single
  // secret you hold matches one of them — there is nothing to configure.
  secret: config().JOBO_WEBHOOK_SECRET,

  onFieldsRequested: async (event, context) => {
    const startedAt = Date.now()
    try {
      return await handleFieldsRequested(event, context, startedAt)
    } catch (error) {
      log.error({ err: error, eventId: context.eventId }, 'webhook handler failed')
      completeEvent(context.eventId, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      })
      // Rule 1. A cancel is a clean, intentional end to the application; a 500
      // would fail it with `callback_rejected` and tell the user nothing.
      return cancel()
    }
  },

  onSubmitted: (event, context) => handleTerminal(event, context),
  onFailed: (event, context) => handleTerminal(event, context),
  onCanceled: (event, context) => handleTerminal(event, context),

  /**
   * The portal's "verify" button. Note it has no `application` key — a handler
   * that assumes one will throw here, which is exactly what the ping is meant
   * to catch. Answering it is how you prove the whole pipe works before
   * spending a create quota.
   */
  onPing: (event, context) => {
    claimEvent({
      eventId: context.eventId,
      type: event.type,
      joboApplicationId: null,
      applicationId: null,
      correctionRound: null,
      attempt: context.attempt,
      rawBody: decoder.decode(context.raw)
    })
    completeEvent(context.eventId, {
      status: 'answered',
      responseBody: JSON.stringify({ ok: true })
    })
    log.info({ eventId: context.eventId }, 'ping verified')
  },

  /**
   * A type this SDK version does not know. Jobo may add types; the SDK already
   * acknowledges them with 200 so delivery does not retry for 24 hours.
   */
  onUnknown: (event, context) => {
    log.warn({ eventId: context.eventId, type: event.type }, 'unknown event type; acknowledging')
  },

  onError: (error) => {
    log.error({ err: error }, 'callback handler returned an error response')
  }
})

// ─── application.fields_requested ────────────────────────────────────────────

async function handleFieldsRequested(
  event: FieldsRequestedEvent,
  context: CallbackContext,
  startedAt: number
): Promise<AnswerCommand> {
  const local = db
    .select()
    .from(applications)
    .where(eq(applications.joboApplicationId, event.application.id))
    .get()

  const claim = claimEvent({
    eventId: context.eventId,
    type: event.type,
    joboApplicationId: event.application.id,
    applicationId: local?.id ?? null,
    correctionRound: event.step.correction_round,
    attempt: context.attempt,
    rawBody: decoder.decode(context.raw)
  })

  // ── Replay ────────────────────────────────────────────────────────────────
  if (claim.status === 'replay') {
    if (claim.responseBody) {
      log.info({ eventId: context.eventId, attempt: context.attempt }, 'replaying stored answer')
      return JSON.parse(claim.responseBody) as AnswerCommand
    }
    // Still in flight. Wait for the original rather than paying for a second
    // generation — Jobo accepts only the first valid command anyway.
    const budget = remainingBudget(event.created_at)
    const settled = await awaitResponse(context.eventId, Math.max(budget, 0))
    if (settled) {
      log.info({ eventId: context.eventId, attempt: context.attempt }, 'awaited in-flight answer')
      return JSON.parse(settled) as AnswerCommand
    }
    log.warn(
      { eventId: context.eventId, attempt: context.attempt },
      'in-flight answer never arrived; canceling'
    )
    return cancel()
  }

  // ── Answer ────────────────────────────────────────────────────────────────
  const work = generate(event, local, startedAt)
  trackInflight(context.eventId, work)
  return JSON.parse(await work) as AnswerCommand
}

async function generate(
  event: FieldsRequestedEvent,
  local: typeof applications.$inferSelect | undefined,
  startedAt: number
): Promise<string> {
  if (!local) {
    // A callback for an application this app did not create. Without a profile
    // there is nothing to answer from, so end it cleanly.
    log.warn({ joboApplicationId: event.application.id }, 'no local application; canceling')
    const body = JSON.stringify(cancel())
    completeEvent(event.id, { status: 'canceled', responseBody: body, error: 'unknown application' })
    return body
  }

  const profile = db.select().from(profiles).where(eq(profiles.id, local.profileId)).get()
  if (!profile) {
    const body = JSON.stringify(cancel())
    completeEvent(event.id, { status: 'canceled', responseBody: body, error: 'profile deleted' })
    return body
  }

  // The previous round's answers, so a correction can re-send a complete
  // snapshot instead of a delta (Jobo re-sends the FULL field list each round).
  const previousAnswers =
    event.step.correction_round > 0 ? readPreviousAnswers(event.application.id, event.step.id) : []

  const budgetMs = Math.min(
    Math.max(remainingBudget(event.created_at) - RESERVE_MS, 0),
    config().ANSWER_BUDGET_MS
  )

  const ctx: AnswerContext = {
    profile: profile.data,
    eeo: profile.eeo ?? emptyEeo,
    resumeUrl: signResumeUrl(profile.id),
    resumeFilename: profile.resumeFilename,
    resumeContentType: profile.resumeContentType,
    resumeText: profile.resumeText,
    applyUrl: local.applyUrl,
    providerName: local.providerName ?? undefined,
    commandErrors: event.step.command_errors ?? [],
    correctionRound: event.step.correction_round,
    previousAnswers,
    budgetMs
  }

  log.info(
    {
      eventId: event.id,
      applicationId: local.id,
      step: event.step.sequence,
      correctionRound: event.step.correction_round,
      fields: event.step.fields.length,
      budgetMs
    },
    'generating answers'
  )

  const { command, result } = await buildCommand(event.step.fields, ctx)
  const body = JSON.stringify(command)

  completeEvent(event.id, {
    status: command.action === 'proceed' ? 'answered' : 'canceled',
    responseBody: body,
    trace: result.trace,
    llmModel: result.llmModel,
    llmMs: result.llmMs,
    totalMs: Date.now() - startedAt,
    error: result.llmError
  })

  db.update(applications)
    .set({ status: 'awaiting_answers', updatedAt: Date.now() })
    .where(eq(applications.id, local.id))
    .run()

  log.info(
    {
      eventId: event.id,
      action: command.action,
      answered: command.action === 'proceed' ? command.answers.length : 0,
      unanswerable: result.unanswerable.length,
      llmMs: result.llmMs,
      totalMs: Date.now() - startedAt
    },
    'answered callback'
  )

  return body
}

/**
 * The answers we sent last round, recovered from the stored response of the
 * previous correction round's event.
 */
function readPreviousAnswers(joboApplicationId: string, stepId: string) {
  const rows = db.query.webhookEvents.findMany({
    where: (events, { and, eq: equals }) =>
      and(
        equals(events.joboApplicationId, joboApplicationId),
        equals(events.type, 'application.fields_requested')
      ),
    orderBy: (events, { desc }) => desc(events.receivedAt),
    limit: 5
    // .sync() because better-sqlite3 is a synchronous driver — keeping the
    // webhook hot path free of needless awaits.
  }).sync()

  for (const row of rows) {
    if (!row.responseBody) continue
    try {
      const parsed = JSON.parse(row.rawBody) as FieldsRequestedEvent
      if (parsed.step?.id !== stepId) continue
      const command = JSON.parse(row.responseBody) as AnswerCommand
      if (command.action === 'proceed') return command.answers
    } catch {
      // A malformed stored row should never break the current round.
    }
  }
  return []
}

// ─── Terminal events ─────────────────────────────────────────────────────────

async function handleTerminal(
  event: SubmittedEvent | FailedEvent | CanceledEvent,
  context: CallbackContext
): Promise<void> {
  try {
    const local = db
      .select()
      .from(applications)
      .where(eq(applications.joboApplicationId, event.application.id))
      .get()

    const claim = claimEvent({
      eventId: context.eventId,
      type: event.type,
      joboApplicationId: event.application.id,
      applicationId: local?.id ?? null,
      correctionRound: null,
      attempt: context.attempt,
      rawBody: decoder.decode(context.raw)
    })

    if (claim.status === 'replay') return

    // A terminal event carries no failure detail, so the reason for a failure
    // has to be fetched. There is no 120s pressure here — delivery retries run
    // 0/60/300/900/3600/14400/43200/86400s over ~24h — but keep it bounded.
    let failureCode: string | null = null
    let failureMessage: string | null = null
    let failureRetryable: boolean | null = null

    if (local) {
      const detail = await jobo()
        .applications.get(event.application.id, { signal: AbortSignal.timeout(8_000) })
        .catch((error: unknown) => {
          log.warn({ err: error, applicationId: event.application.id }, 'could not fetch detail')
          return null
        })
      if (detail?.failure) {
        failureCode = detail.failure.code
        failureMessage = detail.failure.message
        failureRetryable = detail.failure.retryable
      }

      db.update(applications)
        .set({
          status: event.application.status,
          failureCode,
          failureMessage,
          failureRetryable,
          providerId: detail?.provider_id ?? local.providerId,
          providerName: detail?.provider_name ?? local.providerName,
          lastSyncedAt: Date.now(),
          updatedAt: Date.now()
        })
        .where(eq(applications.id, local.id))
        .run()
    }

    completeEvent(context.eventId, {
      status: 'answered',
      responseBody: JSON.stringify({ ok: true })
    })
    log.info(
      { eventId: context.eventId, status: event.application.status, failureCode },
      'application reached a terminal state'
    )
  } catch (error) {
    // Rule 1 again. Terminal deliveries retry over 24h rather than failing the
    // application, but a 500 here would still bury the real error in Jobo's
    // logs instead of ours.
    log.error({ err: error, eventId: context.eventId }, 'terminal handler failed')
    completeEvent(context.eventId, {
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function remainingBudget(createdAt: string): number {
  const deadline = Date.parse(createdAt) + CALLBACK_DEADLINE_MS
  return Number.isFinite(deadline) ? deadline - Date.now() : CALLBACK_DEADLINE_MS
}
