/**
 * Production-mode job explorer state, kept entirely in the URL.
 *
 * Every filter here is a real `POST /api/jobs/search` filter and every facet
 * count shown next to it comes back from that same call, so the explorer is a
 * faithful picture of what an integration can ask Jobo for:
 *
 *   ?q=engineer&wm=remote&exp=senior&cat=saas&ind=Fintech&co=stripe.com&co=-meta.com
 *
 * List params repeat. A leading `-` on `co`, `ind` or `cat` means exclude.
 * Pure functions only: the page parses, links are built from the parsed value.
 */

export const FACETS = [
  'work_model',
  'experience_level',
  'employment_type',
  'sources',
  'industries',
  'skills',
  'countries',
  'company_categories',
] as const
export type FacetName = (typeof FACETS)[number]
export type Facets = Partial<Record<FacetName, { key: string; count: number }[]>>

export const WORK_MODELS = ['remote', 'hybrid', 'onsite'] as const
export const EXPERIENCE_LEVELS = ['intern', 'entry', 'mid', 'senior', 'lead', 'executive'] as const
export const EMPLOYMENT_TYPES = [
  'full-time',
  'part-time',
  'contract',
  'internship',
  'freelance',
  'temporary',
] as const
export const COMPANY_CATEGORIES = [
  'b2b',
  'b2c',
  'b2b2c',
  'saas',
  'marketplace',
  'service-provider',
] as const
export const SALARY_FLOORS = [80_000, 120_000, 160_000, 200_000] as const
export const POSTED_WINDOWS = { '24h': 1, '7d': 7, '30d': 30 } as const
export type PostedWindow = keyof typeof POSTED_WINDOWS

/** The API caps include/exclude lists; stay well under it. */
const MAX_VALUES = 10
const MAX_LENGTH = 120

export interface IncludeExclude {
  include: string[]
  exclude: string[]
}

export interface JobFilters {
  q: string
  locations: string[]
  /** Company domains, names or Jobo company ids. */
  companies: IncludeExclude
  industries: IncludeExclude
  categories: IncludeExclude
  skills: string[]
  workModels: string[]
  experienceLevels: string[]
  employmentTypes: string[]
  sources: string[]
  minSalary?: number
  posted?: PostedWindow
  page: number
}

export type SearchParams = Record<string, string | string[] | undefined>

export function emptyFilters(): JobFilters {
  return {
    q: '',
    locations: [],
    companies: { include: [], exclude: [] },
    industries: { include: [], exclude: [] },
    categories: { include: [], exclude: [] },
    skills: [],
    workModels: [],
    experienceLevels: [],
    employmentTypes: [],
    sources: [],
    page: 1,
  }
}

function all(params: SearchParams, name: string): string[] {
  const raw = params[name]
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]
  return values.map((v) => v.trim().slice(0, MAX_LENGTH)).filter(Boolean)
}

function first(params: SearchParams, name: string): string {
  return all(params, name)[0] ?? ''
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  return values
    .filter((v) => {
      const key = v.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_VALUES)
}

function allowed(values: string[], options: readonly string[]): string[] {
  return unique(values.map((v) => v.toLowerCase()).filter((v) => options.includes(v)))
}

function signed(values: string[]): IncludeExclude {
  const include = values.filter((v) => !v.startsWith('-'))
  const exclude = values.filter((v) => v.startsWith('-')).map((v) => v.slice(1).trim())
  return { include: unique(include), exclude: unique(exclude.filter(Boolean)) }
}

export function parseFilters(params: SearchParams): JobFilters {
  const companies = signed(all(params, 'co'))
  // The "add a company" form submits the new entry separately, with the
  // button that was pressed deciding include vs exclude.
  const added = first(params, 'co_new')
  if (added) {
    const into = first(params, 'co_op') === '-' ? companies.exclude : companies.include
    if (!into.some((v) => v.toLowerCase() === added.toLowerCase())) into.push(added)
  }
  const salary = Number.parseInt(first(params, 'salary'), 10)
  const posted = first(params, 'posted')
  return {
    q: first(params, 'q'),
    // `location` is the pre-explorer param name; old links keep working.
    locations: unique([...all(params, 'loc'), ...all(params, 'location')]),
    companies: {
      include: companies.include.slice(0, MAX_VALUES),
      exclude: companies.exclude.slice(0, MAX_VALUES),
    },
    industries: signed(all(params, 'ind')),
    categories: (() => {
      const { include, exclude } = signed(all(params, 'cat'))
      return {
        include: allowed(include, COMPANY_CATEGORIES),
        exclude: allowed(exclude, COMPANY_CATEGORIES),
      }
    })(),
    skills: unique(all(params, 'skill')),
    workModels: allowed(all(params, 'wm'), WORK_MODELS),
    experienceLevels: allowed(all(params, 'exp'), EXPERIENCE_LEVELS),
    employmentTypes: allowed(all(params, 'emp'), EMPLOYMENT_TYPES),
    sources: unique(all(params, 'ats').map((v) => v.toLowerCase())),
    minSalary: Number.isFinite(salary) && salary > 0 ? Math.min(salary, 10_000_000) : undefined,
    posted: posted in POSTED_WINDOWS ? (posted as PostedWindow) : undefined,
    page: Math.max(1, Math.min(1000, Number.parseInt(first(params, 'page'), 10) || 1)),
  }
}

/** URL params for a filter state, in a stable order. */
export function filterParams(filters: JobFilters): [string, string][] {
  const out: [string, string][] = []
  const add = (name: string, values: string[]) => values.forEach((v) => out.push([name, v]))
  const addSigned = (name: string, value: IncludeExclude) => {
    add(name, value.include)
    add(
      name,
      value.exclude.map((v) => `-${v}`),
    )
  }
  if (filters.q) out.push(['q', filters.q])
  add('loc', filters.locations)
  addSigned('co', filters.companies)
  addSigned('ind', filters.industries)
  addSigned('cat', filters.categories)
  add('skill', filters.skills)
  add('wm', filters.workModels)
  add('exp', filters.experienceLevels)
  add('emp', filters.employmentTypes)
  add('ats', filters.sources)
  if (filters.minSalary) out.push(['salary', String(filters.minSalary)])
  if (filters.posted) out.push(['posted', filters.posted])
  if (filters.page > 1) out.push(['page', String(filters.page)])
  return out
}

export function filtersHref(filters: JobFilters): string {
  const query = new URLSearchParams(filterParams(filters)).toString()
  return query ? `/jobs?${query}` : '/jobs'
}

export function pageHref(filters: JobFilters, page: number): string {
  return filtersHref({ ...filters, page })
}

/** Any change to what is searched starts again from page one. */
export function withFilters(filters: JobFilters, patch: Partial<JobFilters>): JobFilters {
  return { ...filters, ...patch, page: 1 }
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function hasValue(values: string[], value: string): boolean {
  return values.some((v) => same(v, value))
}

/** Add the value when absent, remove it when present. */
export function toggle(values: string[], value: string): string[] {
  return hasValue(values, value) ? values.filter((v) => !same(v, value)) : [...values, value]
}

/**
 * Move a value into include or exclude (or out of both when it is already
 * there), so a value is never both at once.
 */
export function toggleSigned(
  value: IncludeExclude,
  item: string,
  side: 'include' | 'exclude',
): IncludeExclude {
  const without = (values: string[]) => values.filter((v) => !same(v, item))
  return side === 'include'
    ? { include: toggle(value.include, item), exclude: without(value.exclude) }
    : { include: without(value.include), exclude: toggle(value.exclude, item) }
}

export type ListField =
  'locations' | 'skills' | 'workModels' | 'experienceLevels' | 'employmentTypes' | 'sources'
export type SignedField = 'companies' | 'industries' | 'categories'

export function toggleHref(filters: JobFilters, field: ListField, value: string): string {
  return filtersHref(withFilters(filters, { [field]: toggle(filters[field], value) }))
}

export function toggleSignedHref(
  filters: JobFilters,
  field: SignedField,
  value: string,
  side: 'include' | 'exclude' = 'include',
): string {
  return filtersHref(withFilters(filters, { [field]: toggleSigned(filters[field], value, side) }))
}

export function activeFilterCount(filters: JobFilters): number {
  return (
    (filters.q ? 1 : 0) +
    filters.locations.length +
    filters.companies.include.length +
    filters.companies.exclude.length +
    filters.industries.include.length +
    filters.industries.exclude.length +
    filters.categories.include.length +
    filters.categories.exclude.length +
    filters.skills.length +
    filters.workModels.length +
    filters.experienceLevels.length +
    filters.employmentTypes.length +
    filters.sources.length +
    (filters.minSalary ? 1 : 0) +
    (filters.posted ? 1 : 0)
  )
}

function signedBody(value: IncludeExclude) {
  if (!value.include.length && !value.exclude.length) return undefined
  return {
    ...(value.include.length ? { include: value.include } : {}),
    ...(value.exclude.length ? { exclude: value.exclude } : {}),
  }
}

/**
 * The exact `POST /api/jobs/search` body for a filter state.
 *
 * `sources` is always the Auto Apply–supported ATS list (narrowed to the
 * visitor's ATS picks), so every job shown can actually be applied to.
 */
export function toSearchBody(
  filters: JobFilters,
  supportedIds: readonly string[],
  pageSize: number,
  now: Date = new Date(),
): Record<string, unknown> {
  const picked = supportedIds.filter((id) => filters.sources.includes(id))
  const body: Record<string, unknown> = {}
  if (filters.q) body.queries = [filters.q]
  if (filters.locations.length) body.locations = filters.locations
  body.sources = picked.length ? picked : [...supportedIds]
  const companies = signedBody(filters.companies)
  if (companies) body.companies = companies
  const industries = signedBody(filters.industries)
  if (industries) body.industries = industries
  const categories = signedBody(filters.categories)
  if (categories) body.company_categories = categories
  if (filters.skills.length) body.skills = { include: filters.skills }
  if (filters.workModels.length) body.work_models = filters.workModels
  if (filters.experienceLevels.length) body.experience_levels = filters.experienceLevels
  if (filters.employmentTypes.length) body.employment_types = filters.employmentTypes
  if (filters.minSalary) body.salary_usd = { min: filters.minSalary }
  if (filters.posted) {
    // Whole hours, so the body (and the cURL shown for it) is stable while cached.
    const since = new Date(now.getTime() - POSTED_WINDOWS[filters.posted] * 86_400_000)
    since.setUTCMinutes(0, 0, 0)
    body.posted_after = since.toISOString()
  }
  body.include_facets = [...FACETS]
  body.page = filters.page
  body.page_size = pageSize
  return body
}

/** Cache identity for a filter state: order-insensitive, case-insensitive. */
export function filtersCacheKey(filters: JobFilters): string {
  const norm = (values: string[]) => values.map((v) => v.toLowerCase()).sort()
  const normSigned = (value: IncludeExclude) => [norm(value.include), norm(value.exclude)]
  return JSON.stringify([
    filters.q.toLowerCase(),
    norm(filters.locations),
    normSigned(filters.companies),
    normSigned(filters.industries),
    normSigned(filters.categories),
    norm(filters.skills),
    norm(filters.workModels),
    norm(filters.experienceLevels),
    norm(filters.employmentTypes),
    norm(filters.sources),
    filters.minSalary ?? 0,
    filters.posted ?? '',
    filters.page,
  ])
}

// ── Display labels ──────────────────────────────────────────────────────────

const LABELS: Record<string, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
  intern: 'Intern',
  entry: 'Entry level',
  mid: 'Mid level',
  senior: 'Senior',
  lead: 'Lead',
  executive: 'Executive',
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
  freelance: 'Freelance',
  temporary: 'Temporary',
  b2b: 'B2B',
  b2c: 'B2C',
  b2b2c: 'B2B2C',
  saas: 'SaaS',
  marketplace: 'Marketplace',
  'service-provider': 'Service provider',
}

export function valueLabel(value: string): string {
  return LABELS[value.toLowerCase()] ?? value
}

/** Facet country keys are lowercased names: "united states" → "United States". */
export function countryLabel(value: string): string {
  return value.replace(/\b\p{L}/gu, (c) => c.toUpperCase())
}

export function salaryLabel(min: number): string {
  return `$${Math.round(min / 1000)}k+`
}

export const POSTED_LABELS: Record<PostedWindow, string> = {
  '24h': 'Past 24 hours',
  '7d': 'Past week',
  '30d': 'Past month',
}
