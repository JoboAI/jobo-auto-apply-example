import { ArrowUpRight, Clock, MapPin } from 'lucide-react'
import type { Job } from '@/lib/jobs-types'
import { filtersHref, toggleSignedHref, withFilters, type JobFilters } from '@/lib/jobo/job-filters'
import type { CardApplication } from '@/lib/presentation'
import { CardApply } from './CardApply'
import { SaveButton } from './JobActions'
import { PageLink } from './PageLink'
import { ProductionJobLink, SandboxJobLink } from './SandboxJobLink'

/**
 * One job in the feed: company, role, tags, availability, the Apply button
 * with its live progress (CardApply), and a link to the original posting.
 * With `filters` (production search), company and industry link to filtered
 * searches.
 */
export function JobCard({
  job,
  index,
  saved,
  profileId,
  application,
  production,
  filters,
}: {
  job: Job
  /** Position in the list; picks the placeholder logo colour. */
  index: number
  saved: boolean
  profileId?: string
  application?: CardApplication
  production: boolean
  filters?: JobFilters
}) {
  const search = filters ? { filters } : undefined
  return (
    <article className="job-card">
      <div className="spread">
        <PageLink
          href={`/jobs/${job.slug}`}
          className={`company-mark color-${index % 5}${job.logoUrl ? ' company-logo' : ''}`}
          aria-label={job.company}
        >
          {job.logoUrl ? <img src={job.logoUrl} alt="" loading="lazy" /> : job.mark}
        </PageLink>
        <SaveButton jobId={job.slug} saved={saved} />
      </div>
      <p className="company-name">
        {search && job.companyId ? (
          <PageLink
            href={filtersHref(
              withFilters(search.filters, {
                companies: { include: [job.companyId], exclude: [] },
              }),
            )}
            title={`All jobs at ${job.company}`}
          >
            {job.company}
          </PageLink>
        ) : (
          job.company
        )}
        {job.companyCategories?.length ? (
          <span className="company-kind"> · {job.companyCategories.slice(0, 2).join(' · ')}</span>
        ) : null}
      </p>
      <PageLink href={`/jobs/${job.slug}`} className="job-title">
        {job.role}
      </PageLink>
      <div className="job-location">
        <MapPin size={14} />
        {job.location}
        {job.postedAgo && (
          <>
            <Clock size={13} className="posted-icon" />
            {job.postedAgo}
          </>
        )}
      </div>
      <p className="job-excerpt">{job.about}</p>
      {search ? (
        <div className="tag-row">
          {job.salary && <span className="tag salary-tag">{job.salary}</span>}
          {job.workModel && <span className="tag">{job.workModel}</span>}
          {job.experienceLevel && <span className="tag">{job.experienceLevel}</span>}
          {job.industries?.slice(0, 2).map((industry) => (
            <PageLink
              key={industry}
              className="tag purple-tag"
              href={toggleSignedHref(search.filters, 'industries', industry)}
              title={`Filter by ${industry}`}
            >
              {industry}
            </PageLink>
          ))}
        </div>
      ) : (
        <div className="tag-row">
          <span className="tag">{job.employmentType}</span>
          <span className="tag">{job.department}</span>
        </div>
      )}
      <div className="job-card-footer">
        <span className={`availability ${!job.available ? 'unavailable' : ''}`}>
          <span />
          {job.available && production && job.sourceLogoUrl && (
            <img className="ats-mark" src={job.sourceLogoUrl} alt="" width={14} height={14} />
          )}
          {job.available
            ? production
              ? `Auto Apply · ${job.sourceName ?? 'supported'}`
              : 'Sandbox available'
            : production
              ? 'Not supported'
              : 'Currently unavailable'}
        </span>
        <PageLink href={`/jobs/${job.slug}`} className="job-view">
          View role <ArrowUpRight size={15} />
        </PageLink>
      </div>
      <CardApply
        jobId={job.slug}
        profileId={profileId}
        available={job.available}
        application={application}
        production={production}
      />
      {job.production ? (
        <ProductionJobLink
          url={job.listingUrl ?? job.applyUrl}
          ats={job.sourceName}
          atsLogoUrl={job.sourceLogoUrl}
          title={job.role}
        />
      ) : (
        <SandboxJobLink url={job.applyUrl} slug={job.slug} title={job.role} />
      )}
    </article>
  )
}
