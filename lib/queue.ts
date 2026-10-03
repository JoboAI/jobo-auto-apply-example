import { randomUUID } from 'node:crypto'
import { copyFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { and, asc, eq, gt, isNull, lte, notInArray, or, sql } from 'drizzle-orm'
import { TERMINAL_STATUSES } from '@jobo-ai/autoapply'
import { db, RESUME_DIR } from '@/db/client'
import { applications, profiles, type ApplicationRow } from '@/db/schema'
import type { Job } from './jobs-types'
import { canRetry } from './presentation'
import { validProductionTarget, validSandboxUrl } from './jobs'
import { isApplicationReady } from './resume/completeness'

/**
 * The durable application queue, in Postgres.
 *
 * An Apply click only inserts a row (`enqueueApplication`). Background workers
 * (lib/worker.ts) then claim rows one at a time with a renewable lease, run
 * the engine (lib/application-engine.ts) and release the lease. Nothing in the
 * browser advances an application, so a run survives the tab closing, a
 * deploy, or a worker crash: an expired lease is simply claimed again.
 *
 * The two read-then-write decisions here (enqueue dedupe, claim caps) take a
 * transaction-scoped advisory lock as the FIRST statement of their
 * transaction. Under READ COMMITTED (the default) every later statement then
 * sees all commits made before the lock was granted. REPEATABLE READ would pin
 * an older snapshot and break that.
 */

/** Arbitrary, app-wide advisory lock namespaces (pg_advisory_xact_lock(int, int)). */
const CLAIM_LOCK_NAMESPACE = 727_002
const ENQUEUE_LOCK_NAMESPACE = 727_003

/** How long a claim is valid. Workers renew it every few seconds while running. */
export const LEASE_MS = 120_000
/** Consecutive worker failures before a row is paused for reconciliation. */
const MAX_ATTEMPTS = 6
/** Exponential backoff between failed attempts: 2 s, 4 s, … capped at 5 minutes. */
const BACKOFF_BASE_MS = 2_000
const BACKOFF_MAX_MS = 300_000

/** A reason to refuse an Apply click, written for the candidate to read. */
export class EnqueueRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnqueueRefusedError'
  }
}

/** Thrown when this worker no longer owns the row it is about to write. */
export class LeaseLostError extends Error {
  constructor() {
    super('Application lease lost')
    this.name = 'LeaseLostError'
  }
}

export async function enqueueApplication(
  userId: string,
  profileId: string,
  job: Job,
  retry = false,
  /**
   * Production mode: the visitor's sealed API key. The application runs on
   * that key and goes to a real employer, so it is required for, and only
   * accepted with, a production job.
   */
  production?: { apiKeyCiphertext: string },
): Promise<string> {
  if (job.production) {
    if (!production?.apiKeyCiphertext)
      throw new EnqueueRefusedError('Connect your Jobo API key to apply to real jobs.')
    if (!validProductionTarget(job.slug, job.applyUrl))
      throw new EnqueueRefusedError('Invalid production job.')
  } else if (production || !validSandboxUrl(job.applyUrl, job.slug))
    throw new EnqueueRefusedError('Invalid sandbox job.')

  // Each application gets its own copy of the resume PDF, so editing or
  // replacing the profile later cannot change a run in flight.
  const id = randomUUID()
  const resumeCopy = join(RESUME_DIR, `${id}.pdf`)
  let copied = false
  try {
    return await db.transaction(
      async (tx) => {
        // Per user: two tabs applying to the same job must not both insert.
        await tx.execute(
          sql`select pg_advisory_xact_lock(${ENQUEUE_LOCK_NAMESPACE}, hashtext(${userId}))`,
        )
        const previous = await tx
          .select()
          .from(applications)
          .where(and(eq(applications.userId, userId), eq(applications.jobId, job.slug)))
        const duplicate = previous.find((a) => !canRetry(a))
        if (duplicate) return duplicate.id
        if (previous.length && !retry)
          return previous.sort((a, b) => b.createdAt - a.createdAt)[0].id
        const [profile] = await tx
          .select()
          .from(profiles)
          .where(
            and(
              eq(profiles.id, profileId),
              eq(profiles.userId, userId),
              eq(profiles.archived, false),
            ),
          )
          .limit(1)
        if (!profile || !isApplicationReady(profile))
          throw new EnqueueRefusedError(
            'Review and confirm your contact details, including phone and LinkedIn, before applying.',
          )
        if (!job.available)
          throw new EnqueueRefusedError('This job is not accepting applications right now.')
        await copyFile(join(RESUME_DIR, `${profile.id}.pdf`), resumeCopy)
        copied = true
        await tx.insert(applications).values({
          id,
          userId,
          profileId,
          jobId: job.slug,
          jobSnapshot: job,
          profileSnapshot: {
            data: profile.data,
            resumeText: profile.resumeText,
            resumeFilename: profile.resumeFilename,
            resumeContentType: profile.resumeContentType,
          },
          // Stored before any network call: see applications.idempotencyKey.
          idempotencyKey: randomUUID(),
          applyUrl: job.applyUrl,
          sandbox: !job.production,
          scenarioSlug: job.production ? null : job.slug,
          apiKeyCiphertext: production?.apiKeyCiphertext ?? null,
          status: 'queued',
        })
        return id
      },
      { isolationLevel: 'read committed' },
    )
  } catch (error) {
    // The insert or the commit failed: do not leave an orphaned PDF behind.
    if (copied) await unlink(resumeCopy).catch(() => {})
    throw error
  }
}

/**
 * Rows a worker may pick up. Excluded: finished rows, and paused rows that
 * cannot be reconciled — no upstream id to check, or a production run whose
 * sealed key is gone (nothing can authenticate the status check).
 */
const claimable = and(
  notInArray(applications.status, [...TERMINAL_STATUSES, 'create_failed']),
  sql`not (${applications.status} = 'recovery_required' and (
    ${applications.joboApplicationId} is null
    or (not ${applications.sandbox} and ${applications.apiKeyCiphertext} is null)
  ))`,
)

/**
 * Claim the oldest runnable application, honouring a global cap and a per-user
 * cap on concurrently running applications. Returns null when nothing is
 * runnable or the caps are reached. `now` is injectable for tests.
 */
export async function claimApplication(
  owner: string,
  globalLimit = 2,
  userLimit = 1,
  now = Date.now(),
): Promise<ApplicationRow | null> {
  return db.transaction(
    async (tx) => {
      // One claimer at a time, or two workers could both pass the caps below.
      await tx.execute(sql`select pg_advisory_xact_lock(${CLAIM_LOCK_NAMESPACE}, 1)`)
      const busy = await tx
        .select({ userId: applications.userId, running: sql<number>`count(*)::int` })
        .from(applications)
        .where(and(claimable, gt(applications.leaseUntil, now)))
        .groupBy(applications.userId)
      if (busy.reduce((total, row) => total + row.running, 0) >= globalLimit) return null
      const fullUsers = busy.filter((row) => row.running >= userLimit).map((row) => row.userId)
      const [next] = await tx
        .select()
        .from(applications)
        .where(
          and(
            claimable,
            or(isNull(applications.leaseUntil), lte(applications.leaseUntil, now)),
            lte(applications.nextAttemptAt, now),
            fullUsers.length ? notInArray(applications.userId, fullUsers) : undefined,
          ),
        )
        .orderBy(asc(applications.createdAt))
        .limit(1)
      if (!next) return null
      await tx
        .update(applications)
        .set({ leaseOwner: owner, leaseUntil: now + LEASE_MS })
        .where(eq(applications.id, next.id))
      return { ...next, leaseOwner: owner, leaseUntil: now + LEASE_MS }
    },
    { isolationLevel: 'read committed' },
  )
}

/** Extend a lease this worker still owns. False when it has been taken over. */
export async function renewLease(id: string, owner: string): Promise<boolean> {
  const renewed = await db
    .update(applications)
    .set({ leaseUntil: Date.now() + LEASE_MS })
    .where(and(eq(applications.id, id), eq(applications.leaseOwner, owner)))
    .returning({ id: applications.id })
  return renewed.length > 0
}

/** Throw LeaseLostError unless `owner` holds an unexpired lease on the row. */
export async function assertLease(id: string, owner: string): Promise<void> {
  const [row] = await db
    .select({ leaseOwner: applications.leaseOwner, leaseUntil: applications.leaseUntil })
    .from(applications)
    .where(eq(applications.id, id))
    .limit(1)
  if (row?.leaseOwner !== owner || (row.leaseUntil ?? 0) <= Date.now()) throw new LeaseLostError()
}

/**
 * Update an application only while `owner` still holds its lease. The
 * ownership check and the write are one statement, so a worker whose lease
 * expired mid-run cannot overwrite the state written by the worker that took
 * the row over.
 */
export async function updateLeased(
  id: string,
  owner: string,
  values: Partial<typeof applications.$inferInsert>,
): Promise<void> {
  const updated = await db
    .update(applications)
    .set(values)
    .where(
      and(
        eq(applications.id, id),
        eq(applications.leaseOwner, owner),
        gt(applications.leaseUntil, Date.now()),
      ),
    )
    .returning({ id: applications.id })
  if (updated.length === 0) throw new LeaseLostError()
}

/**
 * Give the row back. With `error`, count a failed attempt and back off; after
 * MAX_ATTEMPTS the row is paused as `recovery_required`, which only lets a
 * worker reconcile (check status, cancel) an application Jobo already knows
 * about — it never starts a new one.
 */
export async function releaseLease(id: string, owner: string, error?: string): Promise<void> {
  const [row] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.id, id), eq(applications.leaseOwner, owner)))
    .limit(1)
  if (!row) return
  const failures = error ? row.attemptCount + 1 : 0
  await db
    .update(applications)
    .set({
      leaseOwner: null,
      leaseUntil: null,
      attemptCount: failures,
      workerError: error ?? null,
      nextAttemptAt: error
        ? Date.now() + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(failures, 8))
        : 0,
      ...(failures >= MAX_ATTEMPTS
        ? {
            status: 'recovery_required',
            cancelRequested: true,
            stopReason: row.joboApplicationId
              ? 'We could not finish this application. We are checking its final status before allowing another attempt.'
              : 'We could not confirm whether this application started. It is paused for review to prevent a duplicate submission.',
          }
        : {}),
    })
    .where(and(eq(applications.id, id), eq(applications.leaseOwner, owner)))
}
