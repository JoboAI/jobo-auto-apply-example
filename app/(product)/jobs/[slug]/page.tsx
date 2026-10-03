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
import { getJobs, isProductionJobId } from '@/lib/jobs'
import type { Job } from '@/lib/jobs-types'
import { getCompanyProfile, getProductionJobDetail, JobsApiError } from '@/lib/jobo/jobs-api'
import type { CompanyProfile } from '@/lib/jobo/company-profile'
import type { JobDetail } from '@/lib/jobo/job-format'
import { atsLogo, supportedAts } from '@/lib/jobo/supported-ats'
import { AtsBadge } from '@/components/AtsBadge'
import { CompanyPanel } from '@/components/CompanyPanel'
import { DetailTabs } from '@/components/DetailTabs'
import { JobDetailPanel } from '@/components/JobDetailPanel'
import { productionApiKey } from '@/lib/user-settings'
import { ApplyButton, SaveButton } from '@/components/JobActions'
import { ProductionJobLink, SandboxJobLink } from '@/components/SandboxJobLink'

export const metadata: Metadata = { title: 'Job' }
export default async function JobPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireUser(),
    { slug } = await params
  let job: Job | undefined
  let detail: { detail: JobDetail; raw: unknown; url: string } | undefined
  let company: CompanyProfile | null = null
  if (isProductionJobId(slug)) {
    const apiKey = await productionApiKey(user.id)
    if (!apiKey)
      return (
        <div className="empty-state">
          <h1>This is a real job.</h1>
          <p>Switch to production mode with your Jobo API key to view and apply to it.</p>
          <PageLink href="/jobs" className="button primary">
            Back to jobs
          </PageLink>
        </div>
      )
    try {
      const loaded = await getProductionJobDetail(apiKey, slug)
      job = loaded.job
      detail = loaded
      // A profile that fails to load costs the tab, never the page.
      if (job.companyId) company = await getCompanyProfile(apiKey, job.companyId).catch(() => null)
    } catch (error) {
      if (error instanceof JobsApiError && error.kind === 'not_found') notFound()
      return (
        <div className="empty-state">
          <h1>Job unavailable</h1>
          <p>
            {error instanceof JobsApiError
              ? error.message
              : 'We couldn’t load this job from Jobo right now.'}
          </p>
          <PageLink href="/jobs" className="button primary">
            Back to jobs
          </PageLink>
        </div>
      )
    }
  } else job = (await getJobs()).find((j) => j.slug === slug)
  if (!job) notFound()
  const production = !!job.production
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
          (await supportedAts()).find((a) => a.id === company.atsProvider)?.name ??
          company.atsProvider.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        logoUrl: atsLogo(company.atsProvider),
      }
    : undefined
  const jobBody = (
    <JobDetailPanel
      job={job}
      detail={detail?.detail}
      raw={detail?.raw}
      url={detail?.url}
      showCompanySummary={!company}
    />
  )
  const extraLocations = (detail?.detail.locations.length ?? 1) - 1
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
            {production && job.sourceName ? (
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
            {production ? (
              <ProductionJobLink
                url={job.listingUrl ?? job.applyUrl}
                ats={job.sourceName}
                atsLogoUrl={job.sourceLogoUrl}
                title={job.role}
              />
            ) : (
              <SandboxJobLink url={job.applyUrl} slug={job.slug} title={job.role} />
            )}
            <small>
              We only use facts you’ve provided. If something’s missing, we stop and let you know.
            </small>
          </div>
        </aside>
      </div>
    </>
  )
}
