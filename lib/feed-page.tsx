import { isApplicationReady } from '@/lib/resume/completeness'
import { redirect } from 'next/navigation'
import { and, desc, eq, sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@/db/client'
import { profiles, savedJobs, applications, steps } from '@/db/schema'
import { requireUser } from './session'
import { getJobs } from './jobs'
import { JobFeed } from '@/components/JobFeed'
import {
  applicationLabel,
  canRetry,
  type CardApplication,
} from './presentation'
import { isTerminal } from './status'
export async function FeedPage({ savedOnly = false }: { savedOnly?: boolean }) {
  const user = await requireUser()
  const saved = db
    .select()
    .from(savedJobs)
    .where(eq(savedJobs.userId, user.id))
    .all()
  const profile = db
    .select()
    .from(profiles)
    .where(and(eq(profiles.userId, user.id), eq(profiles.archived, false)))
    .orderBy(desc(profiles.isDefault), desc(profiles.createdAt))
    .all()
  if (!savedOnly && !profile.length) redirect('/onboarding')
  const apps = db
    .select()
    .from(applications)
    .where(eq(applications.userId, user.id))
    .orderBy(desc(applications.createdAt))
    .all()
  const completed = db
    .select({
      id: steps.applicationId,
      count: sql<number>`count(distinct case when ${steps.submittedAt} is not null then ${steps.stepId} end)`,
    })
    .from(steps)
    .innerJoin(applications, eq(steps.applicationId, applications.id))
    .where(eq(applications.userId, user.id))
    .groupBy(steps.applicationId)
    .all()
  const applicationStates: Record<string, CardApplication> = {}
  for (const app of apps) {
    if (!app.jobId || applicationStates[app.jobId]) continue
    applicationStates[app.jobId] = {
      id: app.id,
      status: app.status,
      label: applicationLabel(app),
      active: !isTerminal(app.status),
      retryable: canRetry(app),
      cancelRequested: app.cancelRequested,
      answeredSteps: completed.find((step) => step.id === app.id)?.count ?? 0,
      message: app.stopReason || app.failureMessage,
    }
  }
  let jobs
  try {
    jobs = await getJobs()
  } catch {
    return (
      <div className="empty-state">
        <h1>Sandbox catalog unavailable</h1>
        <p>
          We couldn’t load sandbox jobs right now. Please try again in a moment.
        </p>
        <Link href={savedOnly ? '/saved' : '/jobs'} className="button primary">
          Try again
        </Link>
      </div>
    )
  }
  return (
    <JobFeed
      jobs={jobs}
      savedIds={saved.map((s) => s.jobId)}
      name={user.name}
      savedOnly={savedOnly}
      profileId={profile.find(isApplicationReady)?.id}
      applicationStates={applicationStates}
      applicationCount={apps.length}
      submittedCount={apps.filter((a) => a.status === 'submitted').length}
    />
  )
}
