'use client'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowRight, Bookmark, Search, SlidersHorizontal } from 'lucide-react'
import type { Job } from '@/lib/jobs-types'
import type { JobFilters } from '@/lib/jobo/job-filters'
import type { CardApplication } from '@/lib/presentation'
import { FeedPager } from './FeedPager'
import { JobCard } from './JobCard'
import { PageLink } from './PageLink'

/**
 * The list of jobs. In sandbox mode it filters the (small) fictional catalog
 * in the browser; in production mode the search, facets and summary are
 * server-rendered (components/JobExplorer.tsx) and passed in through `search`.
 */
export function JobFeed({
  jobs,
  savedIds,
  savedOnly = false,
  profileId,
  applicationStates,
  mode = 'sandbox',
  search,
  aside,
}: {
  jobs: Job[]
  savedIds: string[]
  savedOnly?: boolean
  profileId?: string
  applicationStates: Record<string, CardApplication>
  mode?: 'sandbox' | 'production'
  /**
   * Production discovery: a server-side search with facets. The filter column
   * and the results summary are server-rendered and passed in whole.
   */
  search?: {
    filters: JobFilters
    total: number
    page: number
    totalPages: number
    explorer: ReactNode
    summary: ReactNode
  }
  /** The side column, when there is one (components/FeedAside.tsx). */
  aside?: ReactNode
}) {
  const production = mode === 'production'
  // Sandbox filters live in the URL (?q=&location=&department=), written with
  // replaceState: a reload, or the live-progress fallback reload, keeps them.
  const params = useSearchParams()
  const [query, setQuery] = useState(search ? '' : (params.get('q') ?? '')),
    [location, setLocation] = useState(search ? '' : (params.get('location') ?? '')),
    [department, setDepartment] = useState(search ? '' : (params.get('department') ?? ''))
  useEffect(() => {
    if (search) return
    const url = new URL(window.location.href)
    for (const [key, value] of [
      ['q', query],
      ['location', location],
      ['department', department],
    ] as const)
      if (value) url.searchParams.set(key, value)
      else url.searchParams.delete(key)
    // `null` state, as Next.js documents: the router then adopts this URL
    // instead of restoring its own on the next refresh or server action.
    if (url.href !== window.location.href) window.history.replaceState(null, '', url)
  }, [search, query, location, department])
  const filtered = useMemo(
    () =>
      search
        ? jobs
        : jobs.filter(
            (j) =>
              (!savedOnly || savedIds.includes(j.slug)) &&
              `${j.role} ${j.company} ${j.department}`
                .toLowerCase()
                .includes(query.toLowerCase()) &&
              (!location || j.location === location) &&
              (!department || j.department === department),
          ),
    [jobs, search, savedOnly, savedIds, query, location, department],
  )
  return (
    <div className={`feed-layout${search ? ' explorer-layout' : ''}`}>
      {search?.explorer}
      <section className="feed-results">
        <div className="section-heading">
          <h2>
            {savedOnly ? 'Saved jobs' : 'Open roles'}{' '}
            <span className="count">
              {search ? search.total.toLocaleString('en') : filtered.length}
            </span>
          </h2>
          <span className="subtle">
            {production
              ? 'Real jobs · Auto Apply–supported ATSes only'
              : 'Fictional jobs · Real API flows'}
          </span>
        </div>
        {search ? (
          search.summary
        ) : (
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
        )}
        <div className="job-grid">
          {filtered.map((job, i) => (
            <JobCard
              key={job.slug}
              job={job}
              index={i}
              saved={savedIds.includes(job.slug)}
              profileId={profileId}
              application={applicationStates[job.slug]}
              production={production}
              filters={search?.filters}
            />
          ))}
        </div>
        {search && <FeedPager search={search} />}
        {!filtered.length && (
          <div className="empty-state">
            <Bookmark size={30} />
            <h2>
              {savedOnly && !savedIds.length ? 'Save a job to apply later.' : 'No matching jobs.'}
            </h2>
            <p>
              {savedOnly && !savedIds.length
                ? 'Bookmark a role to come back to it.'
                : 'Try another keyword or clear your filters.'}
            </p>
            {savedOnly && (
              <PageLink href="/jobs" className="button secondary">
                Discover jobs <ArrowRight size={16} />
              </PageLink>
            )}
          </div>
        )}
      </section>
      {aside}
    </div>
  )
}
