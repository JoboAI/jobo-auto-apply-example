'use server'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { applications } from '@/db/schema'
import { requireUser } from '@/lib/session'
import { getJobs, validSandboxUrl } from '@/lib/jobs'
import { enqueueApplication } from '@/lib/queue'
import { isTerminal } from '@/lib/status'

export async function startApplicationAction(input: {
  jobId: string
  profileId: string
  retry?: boolean
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireUser()
  try {
    const job = (await getJobs()).find((j) => j.slug === input.jobId)
    if (!job?.available || !validSandboxUrl(job.applyUrl, job.slug))
      return {
        ok: false,
        error: 'This sandbox job is not accepting applications right now.',
      }
    const id = enqueueApplication(
      user.id,
      input.profileId,
      job,
      input.retry === true,
    )
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
  const row = db
    .select()
    .from(applications)
    .where(and(eq(applications.id, id), eq(applications.userId, user.id)))
    .get()
  if (!row) return { ok: false, error: 'Application not found.' }
  if (!isTerminal(row.status))
    db.update(applications)
      .set({ cancelRequested: true, updatedAt: Date.now() })
      .where(and(eq(applications.id, id), eq(applications.userId, user.id)))
      .run()
  revalidatePath(`/applications/${id}`)
  return { ok: true }
}
