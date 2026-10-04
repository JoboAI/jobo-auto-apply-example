import type { Metadata } from 'next'
import { PageLink } from '@/components/PageLink'
import { isApplicationReady } from '@/lib/resume/completeness'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, desc, eq } from 'drizzle-orm'
import {
  ArrowLeft,
  MapPin,
  BriefcaseBusiness,
  Sparkles,
  Clock,
  Banknote,
  Layers,
} from 'lucide-react'
import { db } from '@/db/client'
import { profiles, applications, savedJobs } from '@/db/schema'
import { requireUser } from '@/lib/session'
import { isJobId } from '@/lib/jobs'
import { environmentAts, visitorEnvironment } from '@/lib/jobo/environment'
import { getCompanyProfile, getJobDetail, JobsApiError } from '@/lib/jobo/jobs-api'
import type { CompanyProfile } from '@/lib/jobo/company-profile'
import { atsLogo } from '@/lib/jobo/supported-ats'
import { AtsBadge } from '@/components/AtsBadge'
import { CompanyPanel } from '@/components/CompanyPanel'
import { DetailTabs } from '@/components/DetailTabs'
import { JobDetailPanel } from '@/components/JobDetailPanel'
import { ApplyButton, SaveButton } from '@/components/JobActions'
import { JobPostingLink } from '@/components/JobPostingLink'
import { ConnectKeyPrompt } from '@/components/ConnectKeyPrompt'

export const metadata: Metadata = { title: 'Job' }
export default async function JobPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireUser(),
    { slug } = await params
  if (!isJobId(slug)) notFound()
  // The same page in both modes: only the key differs.
  const env = await visitorEnvironment(user.id)
  if (!env) return <ConnectKeyPrompt />
  const production = env.mode === 'production'
  let loaded: Awaited<ReturnType<typeof getJobDetail>>
  let company: CompanyProfile | null = null
  try {
    loaded = await getJobDetail(env, slug)
    // A profile that fails to load costs the tab, never the page.
    if (loaded.job.companyId)
      company = await getCompanyProfile(env, loaded.job.companyId).catch(() => null)
  } catch (error) {
    const missing = error instanceof JobsApiError && error.kind === 'not_found'
    return (
      <div className="empty-state">
        <h1>{missing ? 'Job not found' : 'Job unavailable'}</h1>
        <p>
          {missing
            ? production
              ? 'It may have closed. Sandbox jobs open with a sandbox key.'
              : 'This is not a sandbox job. Real jobs open with a production key.'
            : error instanceof JobsApiError
              ? error.message
              : 'We couldn’t load this job from Jobo right now.'}
        </p>
        <PageLink href="/jobs" className="button primary">
          Back to jobs
        </PageLink>
      </div>
    )
  }
  const { job, detail, raw, url } = loaded
  const profile = (
    await db
      .select()
      .from(profiles)
      .where(and(eq(profiles.userId, user.id), eq(profiles.archived, false)))
      .orderBy(desc(profiles.isDefault), desc(profiles.createdAt))
  ).find(isApplicationReady)
  const [existing] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.userId, user.id), eq(applications.jobId, slug)))
    .orderBy(desc(applications.createdAt))
    .limit(1)
  const [saved] = await db
    .select()
    .from(savedJobs)
    .where(and(eq(savedJobs.userId, user.id), eq(savedJobs.jobId, slug)))
    .limit(1)
  const companyAts = company?.atsProvider
    ? {
        name:
          (await environmentAts(env)).find((a) => a.id === company.atsProvider)?.name ??
          company.atsProvider.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        logoUrl: atsLogo(company.atsProvider),
      }
    : undefined
  const jobBody = (
    <JobDetailPanel
      job={job}
      detail={detail}
      raw={raw}
      url={url}
      production={production}
      showCompanySummary={!company}
    />
  )
  const extraLocations = detail.locations.length - 1
  return (
    <>
      <PageLink href="/jobs" className="back-link">
        <ArrowLeft size={16} /> {production ? 'All jobs' : 'All sandbox jobs'}
      </PageLink>
      <div className="detail-layout">
        <article className="surface job-detail">
          <div className="spread">
            {job.logoUrl ? (
              <img className="company-mark large-mark company-logo" src={job.logoUrl} alt="" />
            ) : (
              <span className="company-mark large-mark purple">{job.mark}</span>
            )}
            <SaveButton jobId={slug} saved={!!saved} />
          </div>
          <p className="company-name">{job.company}</p>
          <h1>{job.role}</h1>
          <div className="detail-meta">
            <span>
              <MapPin size={16} />
              {job.location}
              {extraLocations > 0 && (
                <small className="more-locations">+{extraLocations} more</small>
              )}
            </span>
            <span>
              <BriefcaseBusiness size={16} />
              {job.employmentType}
            </span>
            {job.salary && (
              <span>
                <Banknote size={16} />
                {job.salary}
              </span>
            )}
            {(job.experienceLevel || job.workModel) && (
              <span>
                <Layers size={16} />
                {[job.experienceLevel, job.workModel].filter(Boolean).join(' · ')}
              </span>
            )}
            {job.postedAgo && (
              <span>
                <Clock size={16} />
                Posted {job.postedAgo.toLowerCase()}
              </span>
            )}
            {job.sourceName ? (
              <AtsBadge name={job.sourceName} logoUrl={job.sourceLogoUrl} className="tag" />
            ) : (
              <span className="tag">{job.department}</span>
            )}
          </div>
          {company ? (
            <DetailTabs
              label="Job and company details"
              tabs={[
                { id: 'job', label: 'Job details', content: jobBody },
                {
                  id: 'company',
                  label: `About ${company.name}`,
                  content: <CompanyPanel company={company} ats={companyAts} />,
                },
              ]}
            />
          ) : (
            <>
              <hr />
              {jobBody}
            </>
          )}
        </article>
        <aside>
          <div className="aside-card apply-card">
            <span className="mini-icon">
              <Sparkles size={21} />
            </span>
            <h2>{production ? 'Apply with Auto Apply.' : 'Test Auto Apply on this job.'}</h2>
            <p>
              Start the API flow with your reviewed profile. The background worker discovers fields,
              prepares answers, and tracks the result.
            </p>
            <div className="selected-resume">
              <span>APPLYING WITH</span>
              <strong>{profile?.name ?? 'Add a reviewed resume'}</strong>
              <Link href="/profiles">Manage resumes</Link>
            </div>
            <ApplyButton
              jobId={slug}
              profileId={profile?.id}
              available={job.available}
              existingId={existing?.id}
            />
            <JobPostingLink
              url={job.listingUrl ?? job.applyUrl}
              ats={job.sourceName}
              atsLogoUrl={job.sourceLogoUrl}
              title={job.role}
            />
            <small>
              We only use facts you’ve provided. If something’s missing, we stop and let you know.
            </small>
          </div>
        </aside>
      </div>
    </>
  )
}
