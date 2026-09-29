'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  Search,
  MapPin,
  ArrowUpRight,
  BriefcaseBusiness,
  SlidersHorizontal,
  Sparkles,
  ArrowRight,
  Check,
  Bookmark,
} from 'lucide-react'
import type { Job } from '@/lib/jobs-types'
import { SaveButton } from './JobActions'
import { CardApply } from './CardApply'
import { SandboxJobLink } from './SandboxJobLink'
import { ApiDocsLink, SourceLink } from './SourceLink'
import type { CardApplication } from '@/lib/presentation'
export function JobFeed({
  jobs,
  savedIds,
  name,
  savedOnly = false,
  profileId,
  applicationStates,
  applicationCount,
  submittedCount,
}: {
  jobs: Job[]
  savedIds: string[]
  name: string
  savedOnly?: boolean
  profileId?: string
  applicationStates: Record<string, CardApplication>
  applicationCount: number
  submittedCount: number
}) {
  const profileReady = !!profileId
  const [query, setQuery] = useState(''),
    [location, setLocation] = useState(''),
    [department, setDepartment] = useState('')
  const filtered = useMemo(
    () =>
      jobs.filter(
        (j) =>
          (!savedOnly || savedIds.includes(j.slug)) &&
          `${j.role} ${j.company} ${j.department}`
            .toLowerCase()
            .includes(query.toLowerCase()) &&
          (!location || j.location === location) &&
          (!department || j.department === department),
      ),
    [jobs, savedOnly, savedIds, query, location, department],
  )
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {savedOnly
              ? 'SAVED SANDBOX SCENARIOS'
              : 'JOBO AUTO APPLY API · INTERACTIVE DEMO'}
          </div>
          <h1>
            {savedOnly ? 'Saved test jobs.' : 'See Auto Apply in action.'}
          </h1>
          <p>
            {savedOnly
              ? 'Return to saved jobs to test another application flow.'
              : 'Click Apply on a sandbox job and watch the API complete its application flow.'}
          </p>
        </div>
        <span className="soft-label">
          <Sparkles size={14} /> Built for developers
        </span>
      </div>
      {!savedOnly && (
        <section className="discovery-banner">
          <div>
            <span className="eyebrow">FROM DEMO TO YOUR APP</span>
            <h2>
              An Apply button.
              <br />
              An API behind every step.
            </h2>
            <p>
              Explore how this app creates applications, answers discovered
              fields, and tracks results with the Auto Apply API.
            </p>
            <Link href="/profiles" className="text-link">
              {profileReady ? 'Review test profile' : 'Set up a test profile'}{' '}
              <ArrowRight size={16} />
            </Link>
            <SourceLink />
          </div>
          <div className="banner-illustration" aria-hidden="true">
            <div className="paper paper-back" />
            <div className="paper paper-front">
              <div className="paper-head">
                <span />
                <i />
              </div>
              <div className="paper-line" />
              <div className="paper-line short" />
              <div className="paper-line" />
              <div className="paper-line short" />
              <div className="paper-stamp">
                <Check size={24} />
              </div>
            </div>
            <div className="sparkle-one">✧</div>
            <div className="sparkle-two">✧</div>
          </div>
        </section>
      )}
      <div className="feed-layout">
        <section>
          <div className="section-heading">
            <h2>
              {savedOnly ? 'Saved scenarios' : 'Try a sandbox job'}{' '}
              <span className="count">{filtered.length}</span>
            </h2>
            <span className="subtle">Fictional jobs · Real API flows</span>
          </div>
          <div className="filters">
            <label className="search-field">
              <Search size={18} />
              <input
                aria-label="Search jobs"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Job title, company, or keyword"
              />
            </label>
            <div className="filter-row">
              <SlidersHorizontal size={16} />
              <select
                aria-label="Filter by location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              >
                <option value="">All locations</option>
                {[...new Set(jobs.map((j) => j.location))].sort().map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
              <select
                aria-label="Filter by department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                <option value="">All departments</option>
                {[...new Set(jobs.map((j) => j.department))].sort().map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
              {(query || location || department) && (
                <button
                  className="text-link"
                  onClick={() => {
                    setQuery('')
                    setLocation('')
                    setDepartment('')
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="job-grid">
            {filtered.map((job, i) => (
              <article className="job-card" key={job.slug}>
                <div className="spread">
                  <Link
                    href={`/jobs/${job.slug}`}
                    className={`company-mark color-${i % 5}`}
                    aria-label={job.company}
                  >
                    {job.mark}
                  </Link>
                  <SaveButton
                    jobId={job.slug}
                    saved={savedIds.includes(job.slug)}
                  />
                </div>
                <p className="company-name">{job.company}</p>
                <Link href={`/jobs/${job.slug}`} className="job-title">
                  {job.role}
                </Link>
                <div className="job-location">
                  <MapPin size={14} />
                  {job.location}
                </div>
                <p className="job-excerpt">{job.about}</p>
                <div className="tag-row">
                  <span className="tag">{job.employmentType}</span>
                  <span className="tag">{job.department}</span>
                </div>
                <div className="job-card-footer">
                  <span
                    className={`availability ${!job.available ? 'unavailable' : ''}`}
                  >
                    <span />
                    {job.available
                      ? 'Sandbox available'
                      : 'Currently unavailable'}
                  </span>
                  <Link href={`/jobs/${job.slug}`} className="job-view">
                    View role <ArrowUpRight size={15} />
                  </Link>
                </div>
                <CardApply
                  jobId={job.slug}
                  profileId={profileId}
                  available={job.available}
                  application={applicationStates[job.slug]}
                />
                <SandboxJobLink url={job.applyUrl} slug={job.slug} title={job.role} />
              </article>
            ))}
          </div>
          {!filtered.length && (
            <div className="empty-state">
              <Bookmark size={30} />
              <h2>
                {savedOnly && !savedIds.length
                  ? 'Save a scenario to test later.'
                  : 'No matching sandbox jobs.'}
              </h2>
              <p>
                {savedOnly && !savedIds.length
                  ? 'Bookmark a sandbox job to keep its application flow handy.'
                  : 'Try another keyword or clear your filters.'}
              </p>
              {savedOnly && (
                <Link href="/jobs" className="button secondary">
                  Discover jobs <ArrowRight size={16} />
                </Link>
              )}
            </div>
          )}
        </section>
        <aside className="feed-aside">
          <div className="aside-card integration-help">
            <span className="eyebrow">BUILD YOUR INTEGRATION</span>
            <h3>Your data. Jobo’s form automation.</h3>
            <p>
              The API returns typed fields and fills the form. Your app supplies
              the answers; this demo uses profile data and OpenRouter.
            </p>
            <ApiDocsLink />
            <SourceLink />
          </div>
          <div className="aside-card">
            <span className="eyebrow">TEST CANDIDATE PROFILE</span>
            <div className="profile-ring">
              <span>{name.slice(0, 1).toUpperCase()}</span>
              {profileReady && (
                <i>
                  <Check size={12} />
                </i>
              )}
            </div>
            <h3>
              {profileReady
                ? 'Ready to test Auto Apply.'
                : 'Set up your test data.'}
            </h3>
            <p>
              {profileReady
                ? 'Your confirmed profile supplies the facts used to answer application fields.'
                : 'Upload and review a resume before running a sandbox application.'}
            </p>
            <Link href="/profiles" className="button secondary full-width">
              {profileReady ? 'View my profile' : 'Complete profile'}
              <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="aside-card activity-card">
            <div className="section-heading">
              <h3>Demo activity</h3>
              <BriefcaseBusiness size={18} />
            </div>
            <div className="metric">
              <strong>{applicationCount}</strong>
              <span>Applications started</span>
            </div>
            <div className="metric">
              <strong>{submittedCount}</strong>
              <span>Successfully submitted</span>
            </div>
            <Link className="text-link" href="/applications">
              View applications <ArrowRight size={15} />
            </Link>
          </div>
          <div className="quiet-note">
            <Sparkles size={16} />
            <p>
              This demo calls the Auto Apply API against fictional jobs. Use the
              source to see how to integrate it into your own app.
            </p>
          </div>
        </aside>
      </div>
    </>
  )
}
