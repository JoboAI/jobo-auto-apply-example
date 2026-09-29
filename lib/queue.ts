import { randomUUID } from 'node:crypto'
import { copyFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { and, asc, eq, sql } from 'drizzle-orm'
import { db, RESUME_DIR } from '@/db/client'
import { applications, profiles } from '@/db/schema'
import type { Job } from './jobs-types'
import { isTerminal } from './status'
import { canRetry } from './presentation'
import { validSandboxUrl } from './jobs'
import { isApplicationReady } from './resume/completeness'

export function enqueueApplication(
  userId: string,
  profileId: string,
  job: Job,
  retry = false,
) {
  return db.transaction(
    (tx) => {
      if (!validSandboxUrl(job.applyUrl, job.slug))
        throw new Error('Invalid sandbox job.')
      const previous = tx
        .select()
        .from(applications)
        .where(
          and(
            eq(applications.userId, userId),
            eq(applications.jobId, job.slug),
          ),
        )
        .all()
      const duplicate = previous.find((a) => !canRetry(a))
      if (duplicate) return duplicate.id
      if (previous.length && !retry)
        return previous.sort((a, b) => b.createdAt - a.createdAt)[0].id
      const profile = tx
        .select()
        .from(profiles)
        .where(
          and(
            eq(profiles.id, profileId),
            eq(profiles.userId, userId),
            eq(profiles.archived, false),
          ),
        )
        .get()
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
        tx.insert(applications)
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
          .run()
      } catch (error) {
        unlinkSync(join(RESUME_DIR, `${id}.pdf`))
        throw error
      }
      return id
    },
    { behavior: 'immediate' },
  )
}

export const LEASE_MS = 120000
export function claimApplication(
  owner: string,
  globalLimit = 2,
  userLimit = 1,
  now = Date.now(),
) {
  return db.transaction(
    (tx) => {
      const rows = tx
        .select()
        .from(applications)
        .where(sql`${applications.userId} IS NOT NULL`)
        .orderBy(asc(applications.createdAt))
        .all()
        .filter(
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
      tx.update(applications)
        .set({ leaseOwner: owner, leaseUntil: now + LEASE_MS })
        .where(eq(applications.id, next.id))
        .run()
      return next
    },
    { behavior: 'immediate' },
  )
}
export function renewLease(id: string, owner: string) {
  return (
    db
      .update(applications)
      .set({ leaseUntil: Date.now() + LEASE_MS })
      .where(and(eq(applications.id, id), eq(applications.leaseOwner, owner)))
      .run().changes > 0
  )
}
export function releaseLease(id: string, owner: string, error?: string) {
  const row = db
    .select()
    .from(applications)
    .where(and(eq(applications.id, id), eq(applications.leaseOwner, owner)))
    .get()
  if (!row) return
  const failures = error ? row.attemptCount + 1 : 0
  db.update(applications)
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
    .run()
}
