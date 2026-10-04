'use server'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { applications } from '@/db/schema'
import { requireUser } from '@/lib/session'
import { visitorEnvironment } from '@/lib/jobo/environment'
import { getJob, JobsApiError } from '@/lib/jobo/jobs-api'
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
const NO_KEY = 'Connect your Jobo API key before applying.'

export async function startApplicationAction(
  raw: z.input<typeof startInput>,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireUser()
  const parsed = startInput.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Invalid request.' }
  const input = parsed.data
  try {
    // The job is re-read from Jobo on the visitor's own key rather than
    // trusted from the browser. A job from the other mode is not found there.
    const env = await visitorEnvironment(user.id)
    if (!env) return { ok: false, error: NO_KEY }
    let job
    try {
      job = await getJob(env, input.jobId)
    } catch (error) {
      if (error instanceof JobsApiError && error.kind === 'not_found')
        return {
          ok: false,
          error:
            env.mode === 'sandbox'
              ? 'This is not a sandbox job. Connect a production key (jbe_live_…) to apply to real jobs.'
              : 'Job not found. It may have closed, or be a sandbox job.',
        }
      return {
        ok: false,
        error:
          error instanceof JobsApiError
            ? error.message
            : 'We could not load this job from Jobo. Please try again.',
      }
    }
    const id = await enqueueApplication(user.id, input.profileId, job, env, input.retry === true)
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
