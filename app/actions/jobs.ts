'use server'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/db/client'
import { savedJobs } from '@/db/schema'
import { requireUser } from '@/lib/session'
import { getJobs } from '@/lib/jobs'
export async function saveJobAction(jobId: string, saved: boolean) {
  const user = await requireUser()
  try {
    if (saved) {
      if (!(await getJobs()).some((j) => j.slug === jobId))
        return { ok: false, error: 'Job unavailable.' }
      db.insert(savedJobs)
        .values({ userId: user.id, jobId })
        .onConflictDoNothing()
        .run()
    } else
      db.delete(savedJobs)
        .where(and(eq(savedJobs.userId, user.id), eq(savedJobs.jobId, jobId)))
        .run()
    revalidatePath('/jobs')
    revalidatePath('/saved')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not save this job. Please try again.' }
  }
}
