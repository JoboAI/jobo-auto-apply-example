import { randomUUID } from 'node:crypto'
import { copyFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { and, asc, eq, isNotNull, notInArray, sql } from 'drizzle-orm'
import { TERMINAL_STATUSES } from '@jobo-ai/autoapply'
import { db, RESUME_DIR } from '@/db/client'
import { applications, profiles } from '@/db/schema'
import type { Job } from './jobs-types'
import { isTerminal } from './status'
import { canRetry } from './presentation'
import { validSandboxUrl } from './jobs'
import { isApplicationReady } from './resume/completeness'

/**
 * Advisory lock keys. SQLite serialised every writer for free; Postgres does
 * not, so the two read-then-write decisions below take an explicit lock as
 * the FIRST statement of their transaction. Under READ COMMITTED (the
 * default), every later statement then sees all commits made before the lock
 * was granted. REPEATABLE READ would pin an older snapshot and break that.
 */
const LOCK_NAMESPACE = 727_002
const CLAIM_LOCK = 1
const ENQUEUE_LOCK_NAMESPACE = 727_003

export async function enqueueApplication(
  userId: string,
  profileId: string,
  job: Job,
  retry = false,
) {
  if (!validSandboxUrl(job.applyUrl, job.slug))
    throw new Error('Invalid sandbox job.')
  return db.transaction(
    async (tx) => {
      // Per user: two tabs applying to the same job must not both insert.
      await tx.execute(
        sql`select pg_advisory_xact_lock(${ENQUEUE_LOCK_NAMESPACE}, hashtext(${userId}))`,
      )
      const previous = await tx
        .select()
        .from(applications)
        .where(
          and(
            eq(applications.userId, userId),
            eq(applications.jobId, job.slug),
          ),
        )
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
        throw new Error('Review and confirm your contact details, including phone and LinkedIn, before applying.')
      if (!job.available)
        throw new Error('This job is not accepting applications right now.')
      const id = randomUUID()
      copyFileSync(
        join(RESUME_DIR, `${profile.id}.pdf`),
        join(RESUME_DIR, `${id}.pdf`),
      )
      try {
        await tx.insert(applications)
          .values({
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
            idempotencyKey: randomUUID(),
            applyUrl: job.applyUrl,
            sandbox: true,
            scenarioSlug: job.slug,
            status: 'queued',
          })
      } catch (error) {
        unlinkSync(join(RESUME_DIR, `${id}.pdf`))
        throw error
      }
      return id
    },
    { isolationLevel: 'read committed' },
  )
}

export const LEASE_MS = 120000
export async function claimApplication(
  owner: string,
  globalLimit = 2,
  userLimit = 1,
  now = Date.now(),
) {
  return db.transaction(
    async (tx) => {
      // One claimer at a time, or two workers could both pass the caps below.
      await tx.execute(
        sql`select pg_advisory_xact_lock(${LOCK_NAMESPACE}, ${CLAIM_LOCK})`,
      )
      const rows = (
        await tx
          .select()
          .from(applications)
          .where(
            and(
              isNotNull(applications.userId),
              notInArray(applications.status, [...TERMINAL_STATUSES, 'create_failed']),
            ),
          )
          .orderBy(asc(applications.createdAt))
      ).filter(
        (a) =>
          !isTerminal(a.status) &&
          !(a.status === 'recovery_required' && !a.joboApplicationId),
      )
      const busy = rows.filter((a) => (a.leaseUntil ?? 0) > now)
      if (busy.length >= globalLimit) return null
      const next = rows.find(
        (a) =>
          (a.leaseUntil ?? 0) <= now &&
          a.nextAttemptAt <= now &&
          busy.filter((b) => b.userId === a.userId).length < userLimit,
      )
      if (!next) return null
      await tx
        .update(applications)
        .set({ leaseOwner: owner, leaseUntil: now + LEASE_MS })
        .where(eq(applications.id, next.id))
      return next
    },
    { isolationLevel: 'read committed' },
  )
}
export async function renewLease(id: string, owner: string) {
  const renewed = await db
    .update(applications)
    .set({ leaseUntil: Date.now() + LEASE_MS })
    .where(and(eq(applications.id, id), eq(applications.leaseOwner, owner)))
    .returning({ id: applications.id })
  return renewed.length > 0
}
export async function releaseLease(id: string, owner: string, error?: string) {
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
        ? Date.now() + Math.min(300000, 2000 * 2 ** Math.min(failures, 8))
        : 0,
      ...(failures >= 6
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
