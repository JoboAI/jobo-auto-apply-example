import { isApplicationReady } from '@/lib/resume/completeness'
import { redirect } from 'next/navigation'
import { and, desc, eq, sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@/db/client'
import { profiles, savedJobs, applications, steps } from '@/db/schema'
import { requireUser } from './session'
import { getJobs, isProductionJobId } from './jobs'
import type { Job } from './jobs-types'
import {
  getProductionJob,
  JobsApiError,
  searchProductionJobsCached,
} from './jobo/jobs-api'
import { getDemoSettings, productionApiKey } from './user-settings'
import { JobFeed } from '@/components/JobFeed'
import {
  applicationLabel,
  canRetry,
  type CardApplication,
} from './presentation'
import { isTerminal } from './status'
export interface FeedSearch {
  q?: string
  location?: string
  page?: string
}

export async function FeedPage({
  savedOnly = false,
  search = {},
}: {
  savedOnly?: boolean
  search?: FeedSearch
}) {
  const user = await requireUser()
  const settings = await getDemoSettings(user.id)
  const production = settings.mode === 'production'
  const saved = await db
    .select()
    .from(savedJobs)
    .where(eq(savedJobs.userId, user.id))
  const profile = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.userId, user.id), eq(profiles.archived, false)))
    .orderBy(desc(profiles.isDefault), desc(profiles.createdAt))
  if (!savedOnly && !profile.length) redirect('/onboarding')
  const apps = await db
    .select()
    .from(applications)
    .where(eq(applications.userId, user.id))
    .orderBy(desc(applications.createdAt))
  const completed = await db
    .select({
      id: steps.applicationId,
      count: sql<number>`count(distinct case when ${steps.submittedAt} is not null then ${steps.stepId} end)`.mapWith(Number),
    })
    .from(steps)
    .innerJoin(applications, eq(steps.applicationId, applications.id))
    .where(eq(applications.userId, user.id))
    .groupBy(steps.applicationId)
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
  let jobs: Job[]
  let paging: { total: number; page: number; totalPages: number } | undefined
  try {
    if (production) {
      const apiKey = await productionApiKey(user.id)
      if (!apiKey) throw new JobsApiError('unauthorized', 'Reconnect your Jobo API key.')
      if (savedOnly) {
        // Saved real jobs are re-read one by one — GET /api/jobs/{id} is free.
        const ids = saved.map((s) => s.jobId).filter(isProductionJobId)
        const found = await Promise.all(
          ids.map((id) =>
            getProductionJob(apiKey, id).catch((error) => {
              if (error instanceof JobsApiError && error.kind === 'not_found') return null
              throw error
            }),
          ),
        )
        jobs = found.filter((j): j is Job => !!j)
      } else {
        const page = Math.max(1, Number.parseInt(search.page ?? '1', 10) || 1)
        const result = await searchProductionJobsCached(apiKey, {
          q: search.q,
          location: search.location,
          page,
        })
        jobs = result.jobs
        paging = { total: result.total, page: result.page, totalPages: result.totalPages }
      }
    } else jobs = await getJobs()
  } catch (error) {
    const problem = error instanceof JobsApiError ? error : null
    return (
      <div className="empty-state">
        <h1>
          {!production
            ? 'Sandbox catalog unavailable'
            : problem?.kind === 'unauthorized'
              ? 'Your API key was rejected'
              : problem?.kind === 'insufficient_credits'
                ? 'Out of job-search credits'
                : 'Jobs unavailable'}
        </h1>
        <p>
          {production
            ? (problem?.message ?? 'We couldn’t load jobs from Jobo right now. Please try again in a moment.')
            : 'We couldn’t load sandbox jobs right now. Please try again in a moment.'}
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
      mode={settings.mode}
      search={
        production && !savedOnly
          ? { q: search.q ?? '', location: search.location ?? '', ...paging! }
          : undefined
      }
      profileId={profile.find(isApplicationReady)?.id}
      applicationStates={applicationStates}
      applicationCount={apps.length}
      submittedCount={apps.filter((a) => a.status === 'submitted').length}
    />
  )
}
