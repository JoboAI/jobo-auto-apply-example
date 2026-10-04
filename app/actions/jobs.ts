'use server'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/db/client'
import { savedJobs } from '@/db/schema'
import { requireUser } from '@/lib/session'
import { isJobId } from '@/lib/jobs'
import { visitorEnvironment } from '@/lib/jobo/environment'
import { getJob } from '@/lib/jobo/jobs-api'

/** Save or unsave a job (a Jobo job id, in the visitor's current mode). */
export async function saveJobAction(jobId: string, saved: boolean) {
  const user = await requireUser()
  if (typeof jobId !== 'string' || !jobId || jobId.length > 100 || typeof saved !== 'boolean')
    return { ok: false, error: 'Invalid request.' }
  try {
    if (saved) {
      if (!isJobId(jobId)) return { ok: false, error: 'Job unavailable.' }
      // Only a job the visitor can see on their current key.
      const env = await visitorEnvironment(user.id)
      if (!env) return { ok: false, error: 'Connect your Jobo API key first.' }
      await getJob(env, jobId)
      await db.insert(savedJobs).values({ userId: user.id, jobId }).onConflictDoNothing()
    } else
      await db
        .delete(savedJobs)
        .where(and(eq(savedJobs.userId, user.id), eq(savedJobs.jobId, jobId)))
    revalidatePath('/jobs')
    revalidatePath('/saved')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not save this job. Please try again.' }
  }
}
