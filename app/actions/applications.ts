'use server'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { applications } from '@/db/schema'
import { requireUser } from '@/lib/session'
import { getJobs, isProductionJobId, validProductionTarget, validSandboxUrl } from '@/lib/jobs'
import { getProductionJob, JobsApiError } from '@/lib/jobo/jobs-api'
import { openApiKey, productionKeyCiphertext } from '@/lib/user-settings'
import { enqueueApplication } from '@/lib/queue'
import { isTerminal } from '@/lib/status'

export async function startApplicationAction(input: {
  jobId: string
  profileId: string
  retry?: boolean
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireUser()
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
      id = await enqueueApplication(
        user.id,
        input.profileId,
        job,
        input.retry === true,
      )
    }
    revalidatePath('/applications')
    revalidatePath('/jobs')
    revalidatePath('/saved')
    return { ok: true, id }
  } catch {
    return {
      ok: false,
      error:
        'We could not queue this application. Check your confirmed resume and try again.',
    }
  }
}
export async function cancelApplicationAction(id: string) {
  const user = await requireUser()
  const [row] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.id, id), eq(applications.userId, user.id)))
    .limit(1)
  if (!row) return { ok: false, error: 'Application not found.' }
  if (!isTerminal(row.status))
    await db.update(applications)
      .set({ cancelRequested: true, updatedAt: Date.now() })
      .where(and(eq(applications.id, id), eq(applications.userId, user.id)))
  revalidatePath(`/applications/${id}`)
  return { ok: true }
}
