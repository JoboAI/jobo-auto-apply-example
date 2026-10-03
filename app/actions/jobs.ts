'use server'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/db/client'
import { savedJobs } from '@/db/schema'
import { requireUser } from '@/lib/session'
import { getJobs, isProductionJobId } from '@/lib/jobs'
import { getProductionJob } from '@/lib/jobo/jobs-api'
import { productionApiKey } from '@/lib/user-settings'

/** Save or unsave a job (sandbox slug or production job id) for the user. */
export async function saveJobAction(jobId: string, saved: boolean) {
  const user = await requireUser()
  if (typeof jobId !== 'string' || !jobId || jobId.length > 100 || typeof saved !== 'boolean')
    return { ok: false, error: 'Invalid request.' }
  try {
    if (saved) {
      if (isProductionJobId(jobId)) {
        const apiKey = await productionApiKey(user.id)
        if (!apiKey) return { ok: false, error: 'Switch to production mode to save real jobs.' }
        await getProductionJob(apiKey, jobId)
      } else if (!(await getJobs()).some((j) => j.slug === jobId))
        return { ok: false, error: 'Job unavailable.' }
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
