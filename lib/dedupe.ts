import { eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { webhookEvents } from '@/db/schema'

/**
 * Webhook replay handling.
 *
 * Jobo reuses the same `X-Jobo-Webhook-Id` across every delivery attempt of an
 * event, and the id is materialised in Jobo's database *before* any network
 * I/O. A durable workflow retry can therefore replay the same id long after the
 * 0s/5s/20s transport window has closed — so an in-memory map alone is not
 * enough, and the persisted claim is the real guarantee.
 *
 * The in-memory map still earns its place: it collapses the common case, where
 * a retry arrives while the first attempt is still generating answers, so we do
 * not pay for a second LLM call.
 *
 * Correctness does not actually depend on any of this — Jobo accepts only the
 * first valid command per step. This is about not spending money twice.
 */

declare global {
  // eslint-disable-next-line no-var
  var __joboInflight: Map<string, Promise<string>> | undefined
}

/** Survives Next.js HMR, which would otherwise reset it mid-request. */
const inflight: Map<string, Promise<string>> = (globalThis.__joboInflight ??= new Map())

export type ClaimResult =
  | { status: 'claimed' }
  | { status: 'replay'; responseBody: string | null }

export interface ClaimSeed {
  eventId: string
  type: string
  joboApplicationId: string | null
  applicationId: string | null
  correctionRound: number | null
  attempt: number
  rawBody: string
}

/**
 * Claim an event id, atomically.
 *
 * `INSERT ... ON CONFLICT DO NOTHING` makes this a single statement with no
 * check-then-act window: exactly one caller gets `claimed`, everyone else gets
 * `replay`. This is the reason the events table uses the `evt_` value as its
 * primary key rather than a surrogate id.
 */
export function claimEvent(seed: ClaimSeed): ClaimResult {
  const inserted = db
    .insert(webhookEvents)
    .values({
      id: seed.eventId,
      type: seed.type,
      joboApplicationId: seed.joboApplicationId,
      applicationId: seed.applicationId,
      correctionRound: seed.correctionRound,
      firstAttempt: seed.attempt,
      attemptsSeen: 1,
      status: 'processing',
      rawBody: seed.rawBody
    })
    .onConflictDoNothing()
    .run()

  if (inserted.changes > 0) return { status: 'claimed' }

  // Someone already has it. Record that we saw another attempt, and hand back
  // whatever they answered (null if they are still working).
  db.update(webhookEvents)
    .set({ attemptsSeen: sql`${webhookEvents.attemptsSeen} + 1` })
    .where(eq(webhookEvents.id, seed.eventId))
    .run()

  const existing = db
    .select({ responseBody: webhookEvents.responseBody })
    .from(webhookEvents)
    .where(eq(webhookEvents.id, seed.eventId))
    .get()

  return { status: 'replay', responseBody: existing?.responseBody ?? null }
}

/** Register work for an event so a concurrent replay can await it. */
export function trackInflight(eventId: string, work: Promise<string>): Promise<string> {
  inflight.set(eventId, work)
  void work.finally(() => inflight.delete(eventId))
  return work
}

export function getInflight(eventId: string): Promise<string> | undefined {
  return inflight.get(eventId)
}

/**
 * Wait for a concurrent handler to finish, within the remaining budget.
 * Falls back to polling the row, because the first attempt may have been
 * handled by a different process.
 */
export async function awaitResponse(
  eventId: string,
  budgetMs: number
): Promise<string | null> {
  const own = inflight.get(eventId)
  if (own) {
    return own.catch(() => null)
  }

  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    const row = db
      .select({ responseBody: webhookEvents.responseBody, status: webhookEvents.status })
      .from(webhookEvents)
      .where(eq(webhookEvents.id, eventId))
      .get()

    if (row?.responseBody) return row.responseBody
    if (row?.status === 'error') return null

    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return null
}

export function completeEvent(
  eventId: string,
  update: {
    status: string
    responseBody?: string
    trace?: unknown
    llmModel?: string
    llmMs?: number
    totalMs?: number
    error?: string
  }
): void {
  db.update(webhookEvents)
    .set({
      status: update.status,
      responseBody: update.responseBody,
      trace: update.trace as never,
      llmModel: update.llmModel,
      llmMs: update.llmMs,
      totalMs: update.totalMs,
      error: update.error,
      respondedAt: Date.now()
    })
    .where(eq(webhookEvents.id, eventId))
    .run()
}
