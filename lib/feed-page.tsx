import { isApplicationReady } from '@/lib/resume/completeness'
import { and, desc, eq, sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@/db/client'
import { profiles, savedJobs, applications, steps } from '@/db/schema'
import { requireUser } from './session'
import { isJobId } from './jobs'
import type { Job } from './jobs-types'
import { environmentAts, visitorEnvironment } from './jobo/environment'
import { getJob, JobsApiError, searchJobsCached, type JobSearchResult } from './jobo/jobs-api'
import { parseFilters, type JobFilters, type SearchParams } from './jobo/job-filters'
import { FeedAside } from '@/components/FeedAside'
import { FeedHeader } from '@/components/FeedHeader'
import { JobFeed } from '@/components/JobFeed'
import { ExplorerSummary, JobExplorer } from '@/components/JobExplorer'
import { ConnectKeyPrompt } from '@/components/ConnectKeyPrompt'
import { accessProblem, applicationLabel, canRetry, type CardApplication } from './presentation'
import { isTerminal } from './status'
export type FeedSearch = SearchParams

/**
 * The job feed, shared by /jobs and /saved: a search of the Jobs API on the
 * visitor's key (lib/jobo/environment.ts), merged with the candidate's saved
 * jobs and latest application per job.
 */
export async function FeedPage({
  savedOnly = false,
  search = {},
}: {
  savedOnly?: boolean
  search?: FeedSearch
}) {
  const user = await requireUser()
  const [env, saved, profile, apps, completed] = await Promise.all([
    visitorEnvironment(user.id),
    db.select().from(savedJobs).where(eq(savedJobs.userId, user.id)),
    db
      .select()
      .from(profiles)
      .where(and(eq(profiles.userId, user.id), eq(profiles.archived, false)))
      .orderBy(desc(profiles.isDefault), desc(profiles.createdAt)),
    db
      .select()
      .from(applications)
      .where(eq(applications.userId, user.id))
      .orderBy(desc(applications.createdAt)),
    // Steps answered per application, for the progress shown on job cards.
    db
      .select({
        id: steps.applicationId,
        count:
          sql<number>`count(distinct case when ${steps.submittedAt} is not null then ${steps.stepId} end)`.mapWith(
            Number,
          ),
      })
      .from(steps)
      .innerJoin(applications, eq(steps.applicationId, applications.id))
      .where(eq(applications.userId, user.id))
      .groupBy(steps.applicationId),
  ])
  // No redirect() here: inside the streamed (product) group it could only
  // happen client-side, after the page loaded. Signed-in visitors without a
  // key or a profile are sent to /onboarding from / instead (app/page.tsx).
  if (!env) return <ConnectKeyPrompt />
  if (!savedOnly && !profile.length)
    return (
      <div className="empty-state">
        <h1>Start with your resume.</h1>
        <p>Upload and review a resume, and Auto Apply will use it to answer application forms.</p>
        <Link href="/onboarding" className="button primary">
          Upload a resume
        </Link>
      </div>
    )
  const production = env.mode === 'production'
  const applicationStates: Record<string, CardApplication> = {}
  for (const app of apps) {
    // Newest first, so each job card shows its latest application.
    if (applicationStates[app.jobId]) continue
    applicationStates[app.jobId] = {
      id: app.id,
      status: app.status,
      label: applicationLabel(app),
      active: !isTerminal(app.status),
      retryable: canRetry(app),
      cancelRequested: app.cancelRequested,
      answeredSteps: completed.find((step) => step.id === app.id)?.count ?? 0,
      message: app.stopReason || app.failureMessage,
      access: accessProblem(app),
    }
  }
  let jobs: Job[]
  let explored: { filters: JobFilters; result: JobSearchResult } | undefined
  try {
    if (savedOnly) {
      // Saved jobs are re-read one by one — GET /api/jobs/{id} is free. A job
      // saved in the other mode is not found here, so it is not shown.
      const found = await Promise.all(
        saved
          .map((s) => s.jobId)
          .filter(isJobId)
          .map((id) =>
            getJob(env, id).catch((error) => {
              if (error instanceof JobsApiError && error.kind === 'not_found') return null
              throw error
            }),
          ),
      )
      jobs = found.filter((j): j is Job => !!j)
    } else {
      const filters = parseFilters(search)
      const result = await searchJobsCached(env, filters)
      jobs = result.jobs
      explored = { filters, result }
    }
  } catch (error) {
    const problem = error instanceof JobsApiError ? error : null
    return (
      <div className="empty-state">
        <h1>
          {problem?.kind === 'unauthorized'
            ? 'Your API key was rejected'
            : problem?.kind === 'insufficient_credits'
              ? 'Out of job-search credits'
              : production
                ? 'Jobs unavailable'
                : 'Sandbox jobs unavailable'}
        </h1>
        <p>
          {problem?.message ??
            'We couldn’t load jobs from Jobo right now. Please try again in a moment.'}
        </p>
        {problem?.kind === 'unauthorized' ? (
          <Link href="/settings#api-key" className="button primary">
            Replace your key
          </Link>
        ) : (
          <Link href={savedOnly ? '/saved' : '/jobs'} className="button primary">
            Try again
          </Link>
        )}
      </div>
    )
  }
  const ats = explored ? await environmentAts(env) : []
  const profileId = profile.find(isApplicationReady)?.id
  return (
    <>
      <FeedHeader savedOnly={savedOnly} production={production} />
      <JobFeed
        jobs={jobs}
        savedIds={saved.map((s) => s.jobId)}
        savedOnly={savedOnly}
        mode={env.mode}
        search={
          explored && {
            filters: explored.filters,
            total: explored.result.total,
            page: explored.result.page,
            totalPages: explored.result.totalPages,
            explorer: <JobExplorer filters={explored.filters} result={explored.result} ats={ats} />,
            summary: (
              <ExplorerSummary filters={explored.filters} result={explored.result} ats={ats} />
            ),
          }
        }
        profileId={profileId}
        applicationStates={applicationStates}
        aside={
          !explored && (
            <FeedAside
              name={user.name}
              profileReady={!!profileId}
              production={production}
              applicationCount={apps.length}
              submittedCount={apps.filter((a) => a.status === 'submitted').length}
            />
          )
        }
      />
    </>
  )
}
