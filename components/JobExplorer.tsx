import { Ban, Building2, Code2, Globe2, Search, TriangleAlert, X } from 'lucide-react'
import { CodeBlock } from './CodeBlock'
import { ExplorerShell } from './ExplorerShell'
import { highlightJson } from '@/lib/json-highlight'
import { curlCommand } from '@/lib/jobo/api-preview'
import type { JobSearchResult } from '@/lib/jobo/jobs-api'
import type { SupportedAts } from '@/lib/jobo/supported-ats'
import {
  activeFilterCount,
  COMPANY_CATEGORIES,
  countryLabel,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  filterParams,
  filtersHref,
  hasValue,
  POSTED_LABELS,
  POSTED_WINDOWS,
  SALARY_FLOORS,
  salaryLabel,
  toggleHref,
  toggleSignedHref,
  valueLabel,
  withFilters,
  WORK_MODELS,
  type FacetName,
  type JobFilters,
  type ListField,
  type PostedWindow,
  type SignedField,
} from '@/lib/jobo/job-filters'
import { PageLink } from './PageLink'

// Filters are PageLinks (full, server-rendered page loads), not next/link:
// see components/PageLink.tsx. The explorer holds no client state worth a
// soft navigation anyway.

type Bucket = { key: string; count: number }

/** Re-submit every other filter alongside a GET form's own input. */
function Carry({ filters }: { filters: JobFilters }) {
  return filterParams(filters).map(([name, value], i) => (
    <input key={`${name}-${i}`} type="hidden" name={name} value={value} />
  ))
}

function countOf(buckets: Bucket[] | undefined, value: string): number | undefined {
  return buckets?.find((b) => b.key.toLowerCase() === value.toLowerCase())?.count
}

function Row({
  href,
  label,
  count,
  selected = false,
  excluded = false,
  excludeHref,
  icon,
}: {
  href: string
  label: string
  /** A small mark before the label (the ATS logos). */
  icon?: string
  count?: number
  selected?: boolean
  excluded?: boolean
  excludeHref?: string
}) {
  return (
    <li className={`facet-row${selected ? ' selected' : ''}${excluded ? ' excluded' : ''}`}>
      <PageLink
        href={href}
        className="facet-option"

        aria-label={`${excluded ? 'Excluded: ' : selected ? 'Selected: ' : ''}${label}${
          count === undefined
            ? ''
            : `, ${count.toLocaleString('en')} ${count === 1 ? 'job' : 'jobs'}`
        }`}
      >
        <span className="facet-box" aria-hidden="true" />
        {icon && <img className="facet-icon" src={icon} alt="" width={14} height={14} />}
        <span className="facet-label">{label}</span>
        {count !== undefined && <span className="facet-count">{count.toLocaleString('en')}</span>}
      </PageLink>
      {excludeHref && (
        <PageLink
          href={excludeHref}
          className="facet-exclude"

          aria-label={excluded ? `Stop excluding ${label}` : `Exclude ${label}`}
          title={excluded ? 'Stop excluding' : 'Exclude'}
        >
          <Ban size={12} />
        </PageLink>
      )}
    </li>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="facet">
      <h3>
        {title}
        {hint && <small>{hint}</small>}
      </h3>
      {children}
    </section>
  )
}

/** A fixed vocabulary (work model, seniority…): every option, counts where known. */
function EnumFacet({
  filters,
  field,
  options,
  buckets,
}: {
  filters: JobFilters
  field: ListField
  options: readonly string[]
  buckets?: Bucket[]
}) {
  return (
    <ul className="facet-list">
      {options.map((value) => (
        <Row
          key={value}
          href={toggleHref(filters, field, value)}
          label={valueLabel(value)}
          count={countOf(buckets, value)}
          selected={hasValue(filters[field], value)}
        />
      ))}
    </ul>
  )
}

/**
 * An open vocabulary (industries, skills, countries): the top buckets Jobo
 * returned, with the current picks pinned first even when the top-8 list no
 * longer contains them.
 */
function BucketFacet({
  buckets = [],
  selected,
  excluded = [],
  label = (v) => v,
  href,
  excludeHref,
}: {
  buckets?: Bucket[]
  selected: string[]
  excluded?: string[]
  label?: (value: string) => string
  href: (value: string) => string
  excludeHref?: (value: string) => string
}) {
  const pinned = [...selected, ...excluded]
  const rest = buckets.filter((b) => !hasValue(pinned, b.key))
  return (
    <ul className="facet-list">
      {pinned.map((value) => (
        <Row
          key={`pin-${value}`}
          href={href(value)}
          label={label(value)}
          count={hasValue(excluded, value) ? undefined : countOf(buckets, value)}
          selected={hasValue(selected, value)}
          excluded={hasValue(excluded, value)}
          excludeHref={excludeHref?.(value)}
        />
      ))}
      {rest.map((b) => (
        <Row
          key={b.key}
          href={href(b.key)}
          label={label(b.key)}
          count={b.count}
          excludeHref={excludeHref?.(b.key)}
        />
      ))}
    </ul>
  )
}

function signedHref(filters: JobFilters, field: SignedField) {
  return {
    include: (value: string) => toggleSignedHref(filters, field, value, 'include'),
    exclude: (value: string) => toggleSignedHref(filters, field, value, 'exclude'),
  }
}

/** Company entries show the name Jobo resolved them to, when it did. */
function companyLabel(result: JobSearchResult, entry: string): string {
  return result.companyNames[entry.toLowerCase()] ?? entry
}

export function JobExplorer({
  filters,
  result,
  ats,
}: {
  filters: JobFilters
  result: JobSearchResult
  ats: readonly SupportedAts[]
}) {
  const facets = result.facets
  const industries = signedHref(filters, 'industries')
  const categories = signedHref(filters, 'categories')
  const companies = signedHref(filters, 'companies')
  const showCategories =
    !!facets.company_categories ||
    filters.categories.include.length + filters.categories.exclude.length > 0
  const facet = (name: FacetName) => facets[name]
  return (
    <ExplorerShell active={activeFilterCount(filters)}>
      <div className="explorer-head">
        <span className="eyebrow">FILTER WITH THE JOBS API</span>
        {activeFilterCount(filters) > 0 && (
          <PageLink href="/jobs" className="text-link">
            Clear all
          </PageLink>
        )}
      </div>

      <form className="explorer-form" method="get" action="/jobs">
        <Carry filters={withFilters(filters, { q: '' })} />
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Search jobs"
            name="q"
            defaultValue={filters.q}
            placeholder="Title or keyword"
          />
        </label>
        <button className="button primary small">Search</button>
      </form>

      <Section title="Company" hint="domain, name or id">
        {(filters.companies.include.length > 0 || filters.companies.exclude.length > 0) && (
          <div className="chip-row">
            {filters.companies.include.map((c) => (
              <PageLink
                key={`i-${c}`}
                className="chip"
                href={companies.include(c)}
                aria-label={`Remove company ${companyLabel(result, c)}`}
              >
                <Building2 size={12} /> {companyLabel(result, c)} <X size={12} />
              </PageLink>
            ))}
            {filters.companies.exclude.map((c) => (
              <PageLink
                key={`e-${c}`}
                className="chip excluded"
                href={companies.exclude(c)}
                aria-label={`Stop excluding company ${companyLabel(result, c)}`}
              >
                <Ban size={12} /> {companyLabel(result, c)} <X size={12} />
              </PageLink>
            ))}
          </div>
        )}
        {result.unmatchedCompanies.length > 0 && (
          <p className="facet-note warn">
            <TriangleAlert size={13} /> No company found for {result.unmatchedCompanies.join(', ')}.
          </p>
        )}
        <form className="explorer-form stacked" method="get" action="/jobs">
          <Carry filters={withFilters(filters, {})} />
          <label className="search-field">
            <Building2 size={16} />
            <input
              aria-label="Company"
              name="co_new"
              placeholder="stripe.com"
              autoComplete="off"
              required
            />
          </label>
          <div className="explorer-form-actions">
            <button className="button secondary small" name="co_op" value="+">
              Only this
            </button>
            <button className="button secondary small" name="co_op" value="-">
              Exclude
            </button>
          </div>
        </form>
      </Section>

      {showCategories && (
        <Section title="Company type">
          <ul className="facet-list">
            {COMPANY_CATEGORIES.filter(
              (c) =>
                countOf(facet('company_categories'), c) !== undefined ||
                hasValue(filters.categories.include, c) ||
                hasValue(filters.categories.exclude, c),
            ).map((c) => (
              <Row
                key={c}
                href={categories.include(c)}
                label={valueLabel(c)}
                count={
                  hasValue(filters.categories.exclude, c)
                    ? undefined
                    : countOf(facet('company_categories'), c)
                }
                selected={hasValue(filters.categories.include, c)}
                excluded={hasValue(filters.categories.exclude, c)}
                excludeHref={categories.exclude(c)}
              />
            ))}
          </ul>
        </Section>
      )}

      {(facet('industries') ||
        filters.industries.include.length + filters.industries.exclude.length > 0) && (
        <Section title="Industry">
          <BucketFacet
            buckets={facet('industries')}
            selected={filters.industries.include}
            excluded={filters.industries.exclude}
            href={industries.include}
            excludeHref={industries.exclude}
          />
        </Section>
      )}

      <Section title="Location">
        <BucketFacet
          buckets={facet('countries')}
          selected={filters.locations}
          label={countryLabel}
          href={(v) => toggleHref(filters, 'locations', v)}
        />
        <form className="explorer-form" method="get" action="/jobs">
          <Carry filters={withFilters(filters, {})} />
          <label className="search-field">
            <Globe2 size={16} />
            <input
              aria-label="Add a location"
              name="loc"
              placeholder="City, region or country"
              required
            />
          </label>
          <button className="button secondary small">Add</button>
        </form>
      </Section>

      <Section title="Seniority">
        <EnumFacet
          filters={filters}
          field="experienceLevels"
          options={EXPERIENCE_LEVELS}
          buckets={facet('experience_level')}
        />
      </Section>

      <Section title="Work model">
        <EnumFacet
          filters={filters}
          field="workModels"
          options={WORK_MODELS}
          buckets={facet('work_model')}
        />
      </Section>

      <Section title="Salary" hint="disclosed, annual USD">
        <ul className="facet-list">
          {SALARY_FLOORS.map((min) => (
            <Row
              key={min}
              href={filtersHref(
                withFilters(filters, { minSalary: filters.minSalary === min ? undefined : min }),
              )}
              label={salaryLabel(min)}
              selected={filters.minSalary === min}
            />
          ))}
        </ul>
      </Section>

      <Section title="Posted">
        <ul className="facet-list">
          {(Object.keys(POSTED_WINDOWS) as PostedWindow[]).map((w) => (
            <Row
              key={w}
              href={filtersHref(
                withFilters(filters, { posted: filters.posted === w ? undefined : w }),
              )}
              label={POSTED_LABELS[w]}
              selected={filters.posted === w}
            />
          ))}
        </ul>
      </Section>

      <Section title="Employment type">
        <EnumFacet
          filters={filters}
          field="employmentTypes"
          options={EMPLOYMENT_TYPES.filter(
            (t) =>
              countOf(facet('employment_type'), t) !== undefined ||
              hasValue(filters.employmentTypes, t),
          )}
          buckets={facet('employment_type')}
        />
      </Section>

      {(facet('skills') || filters.skills.length > 0) && (
        <Section title="Skills">
          <BucketFacet
            buckets={facet('skills')}
            selected={filters.skills}
            href={(v) => toggleHref(filters, 'skills', v)}
          />
        </Section>
      )}

      <Section title="Applicant tracking system">
        <ul className="facet-list">
          {ats.map((a) => (
            <Row
              key={a.id}
              href={toggleHref(filters, 'sources', a.id)}
              label={a.name}
              icon={a.logoUrl}
              count={countOf(facet('sources'), a.id)}
              selected={hasValue(filters.sources, a.id)}
            />
          ))}
        </ul>
      </Section>

      <p className="facet-note">
        Counts are Jobo’s facet counts for the current filters (top values, approximate).
      </p>
    </ExplorerShell>
  )
}

const EXAMPLES: { label: string; patch: Partial<JobFilters> }[] = [
  {
    label: 'Senior · remote · SaaS companies',
    patch: {
      workModels: ['remote'],
      experienceLevels: ['senior'],
      categories: { include: ['saas'], exclude: [] },
    },
  },
  {
    label: 'AI companies',
    patch: { industries: { include: ['Artificial Intelligence'], exclude: [] } },
  },
  { label: '$160k+ posted this week', patch: { minSalary: 160_000, posted: '7d' } },
  {
    label: 'No staffing agencies',
    patch: { industries: { include: [], exclude: ['HR & Staffing'] } },
  },
]

/** Active filters as removable chips, plus the exact request behind the page. */
export function ExplorerSummary({
  filters,
  result,
  ats,
}: {
  filters: JobFilters
  result: JobSearchResult
  ats: readonly SupportedAts[]
}) {
  const chips: { key: string; label: string; href: string; excluded?: boolean }[] = []
  const list = (field: ListField, label: (v: string) => string = valueLabel) =>
    filters[field].forEach((v) =>
      chips.push({ key: `${field}-${v}`, label: label(v), href: toggleHref(filters, field, v) }),
    )
  const signed = (field: SignedField, label: (v: string) => string = (v) => v) => {
    filters[field].include.forEach((v) =>
      chips.push({
        key: `${field}+${v}`,
        label: label(v),
        href: toggleSignedHref(filters, field, v, 'include'),
      }),
    )
    filters[field].exclude.forEach((v) =>
      chips.push({
        key: `${field}-${v}`,
        label: label(v),
        href: toggleSignedHref(filters, field, v, 'exclude'),
        excluded: true,
      }),
    )
  }
  if (filters.q)
    chips.push({
      key: 'q',
      label: `“${filters.q}”`,
      href: filtersHref(withFilters(filters, { q: '' })),
    })
  signed('companies', (v) => companyLabel(result, v))
  signed('categories', valueLabel)
  signed('industries')
  list('locations', countryLabel)
  list('experienceLevels')
  list('workModels')
  list('employmentTypes')
  list('skills', (v) => v)
  list('sources', (v) => ats.find((a) => a.id === v)?.name ?? v)
  if (filters.minSalary)
    chips.push({
      key: 'salary',
      label: salaryLabel(filters.minSalary),
      href: filtersHref(withFilters(filters, { minSalary: undefined })),
    })
  if (filters.posted)
    chips.push({
      key: 'posted',
      label: POSTED_LABELS[filters.posted],
      href: filtersHref(withFilters(filters, { posted: undefined })),
    })

  const json = JSON.stringify(result.request.body, null, 2)
  const curl = curlCommand(result.request.method, result.request.url, {
    headers: [['Content-Type', 'application/json']],
    body: json,
    truncated: false,
  })
  return (
    <div className="explorer-summary">
      {chips.length > 0 ? (
        <div className="filter-bar" aria-label="Active filters">
          {chips.map((chip) => (
            <PageLink
              key={chip.key}
              href={chip.href}

              className={`chip${chip.excluded ? ' excluded' : ''}`}
              aria-label={`Remove filter ${chip.excluded ? 'excluding ' : ''}${chip.label}`}
            >
              {chip.excluded && <Ban size={12} />}
              {chip.label}
              <X size={12} />
            </PageLink>
          ))}
          <PageLink href="/jobs" className="text-link">
            Clear all
          </PageLink>
        </div>
      ) : (
        <div className="filter-bar examples">
          <span className="subtle">Try</span>
          {EXAMPLES.map((example) => (
            <PageLink
              key={example.label}
              className="chip example"
              href={filtersHref(withFilters(filters, example.patch))}
            >
              {example.label}
            </PageLink>
          ))}
        </div>
      )}
      {result.warnings.map((warning) => (
        <p key={warning} className="facet-note warn">
          <TriangleAlert size={13} /> {warning}
        </p>
      ))}
      <details className="api-call">
        <summary>
          <Code2 size={16} /> See the API call behind these results
        </summary>
        <p>
          Every job, count and filter on this page comes from this one request, made with your API
          key. Facets come back in the same response, and the full company profile on a job page is
          a free <code>GET /api/companies/&#123;id&#125;</code>.
        </p>
        <CodeBlock
          title={`${result.request.method} /api/jobs/search`}
          note="X-Api-Key: your key"
          copy={curl}
          copyLabel="Copy as cURL"
          label="Job search request body"
        >
          {highlightJson(json)}
        </CodeBlock>
      </details>
    </div>
  )
}
