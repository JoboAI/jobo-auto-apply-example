'use server'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { applications } from '@/db/schema'
import { requireUser } from '@/lib/session'
import { getJobs, isProductionJobId, validProductionTarget, validSandboxUrl } from '@/lib/jobs'
import { getProductionJob, JobsApiError } from '@/lib/jobo/jobs-api'
import { openApiKey, productionKeyCiphertext } from '@/lib/user-settings'
import { z } from 'zod'
import { enqueueApplication, EnqueueRefusedError } from '@/lib/queue'
import { isTerminal } from '@/lib/status'
import { log } from '@/lib/logger'

/**
 * Applying and canceling. Both only write the database: the background
 * worker (lib/worker.ts) is what talks to Auto Apply.
 *
 * Server actions are public HTTP endpoints, so every argument is validated
 * here rather than trusted from the calling component.
 */

const startInput = z.object({
  jobId: z.string().min(1).max(100),
  profileId: z.string().min(1).max(100),
  retry: z.boolean().optional(),
})
const applicationIdInput = z.string().min(1).max(100)

export async function startApplicationAction(
  raw: z.input<typeof startInput>,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireUser()
  const parsed = startInput.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Invalid request.' }
  const input = parsed.data
  try {
    let id: string
    if (isProductionJobId(input.jobId)) {
      // A real job: only in production mode, on the visitor's own key, and
      // re-read from Jobo here rather than trusting anything from the browser.
      const apiKeyCiphertext = await productionKeyCiphertext(user.id)
      if (!apiKeyCiphertext)
        return {
          ok: false,
          error: 'Switch to production mode with your Jobo API key to apply to real jobs.',
        }
      let job
      try {
        job = await getProductionJob(openApiKey(apiKeyCiphertext), input.jobId)
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof JobsApiError
              ? error.message
              : 'We could not load this job from Jobo. Please try again.',
        }
      }
      if (!job.available || !validProductionTarget(job.slug, job.applyUrl))
        return {
          ok: false,
          error: 'Auto Apply does not support this job’s application system.',
        }
      id = await enqueueApplication(user.id, input.profileId, job, input.retry === true, {
        apiKeyCiphertext,
      })
    } else {
      const job = (await getJobs()).find((j) => j.slug === input.jobId)
      if (!job?.available || !validSandboxUrl(job.applyUrl, job.slug))
        return {
          ok: false,
          error: 'This sandbox job is not accepting applications right now.',
        }
      id = await enqueueApplication(user.id, input.profileId, job, input.retry === true)
    }
    revalidatePath('/applications')
    revalidatePath('/jobs')
    revalidatePath('/saved')
    return { ok: true, id }
  } catch (error) {
    if (error instanceof EnqueueRefusedError) return { ok: false, error: error.message }
    log.error({ error, jobId: input.jobId }, 'could not queue application')
    return { ok: false, error: 'We could not queue this application. Please try again.' }
  }
}

export async function cancelApplicationAction(rawId: string) {
  const user = await requireUser()
  const parsed = applicationIdInput.safeParse(rawId)
  if (!parsed.success) return { ok: false, error: 'Application not found.' }
  const id = parsed.data
  const [row] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.id, id), eq(applications.userId, user.id)))
    .limit(1)
  if (!row) return { ok: false, error: 'Application not found.' }
  // Only a flag: the worker cancels upstream at its next checkpoint.
  if (!isTerminal(row.status))
    await db
      .update(applications)
      .set({ cancelRequested: true, updatedAt: Date.now() })
      .where(and(eq(applications.id, id), eq(applications.userId, user.id)))
  revalidatePath(`/applications/${id}`)
  return { ok: true }
}
