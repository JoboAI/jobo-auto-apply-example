import { createHash } from 'node:crypto'
import { z } from 'zod'
import { config } from '@/lib/config'
import type { Job } from '@/lib/jobs-types'
import { isProductionJobId } from '@/lib/jobs'
import { supportedAts, type SupportedAts } from './supported-ats'
import {
  filtersCacheKey,
  toSearchBody,
  valueLabel,
  type Facets,
  type JobFilters,
} from './job-filters'

/**
 * Production mode's job source: the real Jobo catalog, read with the
 * VISITOR's API key (never the deployment's).
 *
 * Plain fetch rather than a client package — it is two GETs, and the
 * Auto Apply SDK deliberately covers applications only.
 *
 *   POST /api/jobs/search     search + facet counts, billed per job returned
 *   GET  /api/jobs/{id}       one job, free
 *   GET  /api/companies/{id}  the full company profile, free
 *
 * `sources` is the list of ATSes Auto Apply supports, so every job shown can
 * actually be applied to.
 */

export const PAGE_SIZE = 25

export type JobsErrorKind =
  | 'unauthorized'
  | 'insufficient_credits'
  | 'not_found'
  | 'unavailable'

export class JobsApiError extends Error {
  constructor(
    readonly kind: JobsErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'JobsApiError'
  }
}

export { isProductionJobId }

const jobSchema = z.object({
  id: z.string(),
  title: z.string(),
  company: z
    .object({
      id: z.string().nullish(),
      name: z.string().nullish(),
      logo_url: z.string().nullish(),
      website: z.string().nullish(),
      industries: z.array(z.string()).nullish(),
      categories: z.array(z.string()).nullish(),
    })
    .nullish(),
  description: z.string().nullish(),
  summary: z.string().nullish(),
  listing_url: z.string().nullish(),
  apply_url: z.string().nullish(),
  locations: z
    .array(
      z.object({
        location: z.string().nullish(),
        city: z.string().nullish(),
        region: z.string().nullish(),
        country: z.string().nullish(),
      }),
    )
    .nullish(),
  employment_type: z.string().nullish(),
  workplace_type: z.string().nullish(),
  experience_level: z.string().nullish(),
  source: z.string().nullish(),
  responsibilities: z.array(z.string()).nullish(),
  compensation: z
    .object({
      min: z.number().nullish(),
      max: z.number().nullish(),
      currency: z.string().nullish(),
      period: z.string().nullish(),
    })
    .nullish(),
  date_posted: z.string().nullish(),
  qualifications: z
    .object({
      must_have: z
        .object({ skills: z.array(z.object({ name: z.string() })).nullish() })
        .nullish(),
    })
    .nullish(),
})
export type JobDto = z.infer<typeof jobSchema>

const facetSchema = z.array(z.object({ key: z.string(), count: z.number() }))
const searchSchema = z.object({
  jobs: z.array(jobSchema),
  total: z.number().nullish(),
  page: z.number().nullish(),
  total_pages: z.number().nullish(),
  facets: z.record(z.string(), facetSchema).nullish(),
  warnings: z
    .array(z.object({ code: z.string().nullish(), message: z.string().nullish() }))
    .nullish(),
  filters: z
    .object({
      companies: z
        .object({
          matched: z
            .array(
              z.object({
                query: z.string(),
                companies: z.array(z.object({ id: z.string(), name: z.string() })),
              }),
            )
            .nullish(),
          unmatched: z.array(z.string()).nullish(),
          exclude_unmatched: z.array(z.string()).nullish(),
        })
        .nullish(),
    })
    .nullish(),
})

export interface JobSearchResult {
  jobs: Job[]
  total: number
  page: number
  totalPages: number
  facets: Facets
  /** Company filter entries Jobo resolved, by what was typed → company name. */
  companyNames: Record<string, string>
  /** Company filter entries that matched no company. */
  unmatchedCompanies: string[]
  warnings: string[]
  /** What was sent, so the page can show the exact call. */
  request: { method: 'POST'; url: string; body: Record<string, unknown> }
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean)
  const mark = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)
  return mark.toUpperCase()
}

function plainText(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[#*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max).replace(/\s+\S*$/, '')}…`
}

function humanize(value: string | null | undefined): string {
  if (!value) return 'Not specified'
  const text = value.replace(/[_-]+/g, ' ').trim().toLowerCase()
  return text === 'full time' || text === 'part time'
    ? text.replace(' ', '-').replace(/^./, (c) => c.toUpperCase())
    : text.replace(/^./, (c) => c.toUpperCase())
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$' }
const PERIODS: Record<string, string> = { yearly: '/yr', monthly: '/mo', weekly: '/wk', daily: '/day', hourly: '/hr' }

function compact(amount: number): string {
  if (amount >= 1_000_000) return `${+(amount / 1_000_000).toFixed(1)}M`
  if (amount >= 10_000) return `${Math.round(amount / 1000)}k`
  if (amount >= 1000) return `${+(amount / 1000).toFixed(1)}k`
  return String(Math.round(amount))
}

/** "$120k–$160k/yr", or undefined when no pay is disclosed. */
export function salaryRange(pay: JobDto['compensation']): string | undefined {
  const min = pay?.min ?? undefined,
    max = pay?.max ?? undefined
  if (!min && !max) return undefined
  const code = pay?.currency?.toUpperCase() ?? ''
  const symbol = CURRENCY_SYMBOLS[code] ?? (code ? `${code} ` : '')
  const range =
    min && max && min !== max
      ? `${symbol}${compact(min)}–${symbol}${compact(max)}`
      : `${symbol}${compact((min ?? max)!)}`
  return `${range}${PERIODS[pay?.period?.toLowerCase() ?? ''] ?? ''}`
}

/** "Today", "3d ago", "5w ago" — computed when the job is fetched. */
export function postedAgo(value: string | null | undefined, now = Date.now()): string | undefined {
  const at = value ? Date.parse(value) : NaN
  if (!Number.isFinite(at)) return undefined
  const days = Math.max(0, Math.floor((now - at) / 86_400_000))
  if (days === 0) return 'Today'
  if (days < 14) return `${days}d ago`
  if (days < 70) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

/** Only a real ISO alpha-2 reaches the answer engine's work-auth rules. */
function countryCode(value: string | null | undefined): string | undefined {
  const code = value?.trim().toUpperCase()
  if (!code || !/^[A-Z]{2}$/.test(code)) return undefined
  return code === 'UK' ? 'GB' : code
}

function httpsUrl(value: string | null | undefined): string {
  try {
    const url = new URL(value ?? '')
    return url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

/** Map a catalog job onto the demo's Job shape. */
export function toJob(dto: JobDto, supported: readonly SupportedAts[]): Job {
  const company = dto.company?.name?.trim() || 'Unknown company'
  const first = dto.locations?.[0]
  const location =
    first?.location?.trim() ||
    [first?.city, first?.region, first?.country].filter(Boolean).join(', ') ||
    (dto.workplace_type?.toLowerCase() === 'remote' ? 'Remote' : 'Location not listed')
  const ats = supported.find((a) => a.id === dto.source)
  const applyUrl = httpsUrl(dto.apply_url)
  const about = plainText(dto.summary || dto.description || '')
  return {
    slug: dto.id,
    company,
    mark: initials(company),
    role: dto.title,
    location,
    department: ats?.name ?? dto.source ?? 'Unknown ATS',
    employmentType: humanize(dto.employment_type),
    about: truncate(about || 'No description provided.', 1200),
    responsibilities: (dto.responsibilities ?? []).slice(0, 12),
    applyUrl,
    available: !!ats && !!applyUrl,
    production: true,
    source: dto.source ?? undefined,
    sourceName: ats?.name ?? dto.source ?? undefined,
    listingUrl: httpsUrl(dto.listing_url) || undefined,
    logoUrl: httpsUrl(dto.company?.logo_url) || undefined,
    countryCode: countryCode(first?.country),
    companyId: dto.company?.id ?? undefined,
    companyWebsite: dto.company?.website ?? undefined,
    industries: dto.company?.industries?.filter(Boolean) ?? [],
    companyCategories: (dto.company?.categories ?? []).map(valueLabel),
    workModel: dto.workplace_type ?? undefined,
    experienceLevel: dto.experience_level ?? undefined,
    salary: salaryRange(dto.compensation),
    postedAgo: postedAgo(dto.date_posted),
    skills: (dto.qualifications?.must_have?.skills ?? []).map((s) => s.name).filter(Boolean).slice(0, 8),
  }
}

function apiBase(): string {
  return config().JOBO_API_BASE_URL.replace(/\/+$/, '')
}

async function call(
  apiKey: string,
  path: string,
  fetchImpl: typeof fetch,
  body?: unknown,
): Promise<Response> {
  let response: Response
  try {
    response = await fetchImpl(`${apiBase()}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'X-Api-Key': apiKey,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    })
  } catch {
    throw new JobsApiError('unavailable', 'The Jobo API could not be reached. Please try again.')
  }
  if (response.status === 401)
    throw new JobsApiError('unauthorized', 'Jobo rejected this API key. Reconnect with a valid key.')
  if (response.status === 402)
    throw new JobsApiError(
      'insufficient_credits',
      'This API key is out of job-search credits. Top up in the Jobo dashboard, or switch back to sandbox.',
    )
  return response
}

export async function searchProductionJobs(
  apiKey: string,
  filters: JobFilters,
  fetchImpl: typeof fetch = fetch,
): Promise<JobSearchResult> {
  const supported = await supportedAts()
  const request = toSearchBody(filters, supported.map((a) => a.id), PAGE_SIZE)
  const response = await call(apiKey, '/api/jobs/search', fetchImpl, request)
  if (response.status === 400)
    throw new JobsApiError('unavailable', 'Jobo could not run that search. Try removing a filter.')
  if (!response.ok)
    throw new JobsApiError('unavailable', `Job search failed (HTTP ${response.status}).`)
  const body = searchSchema.parse(await response.json())
  const companyNames: Record<string, string> = {}
  for (const match of body.filters?.companies?.matched ?? [])
    if (match.companies[0]) companyNames[match.query.toLowerCase()] = match.companies[0].name
  return {
    jobs: body.jobs.map((dto) => toJob(dto, supported)),
    total: body.total ?? body.jobs.length,
    page: body.page ?? 1,
    totalPages: body.total_pages ?? 1,
    facets: (body.facets ?? {}) as Facets,
    companyNames,
    unmatchedCompanies: [
      ...(body.filters?.companies?.unmatched ?? []),
      ...(body.filters?.companies?.exclude_unmatched ?? []),
    ],
    warnings: (body.warnings ?? [])
      // Unmatched companies are shown on their own chips.
      .filter((w) => !w.code?.startsWith('companies_'))
      .map((w) => w.message ?? '')
      .filter(Boolean),
    request: { method: 'POST', url: `${apiBase()}/api/jobs/search`, body: request },
  }
}

/**
 * Search, cached in memory for a few minutes per key + query.
 *
 * Search is billed per job returned, and the feed re-renders every few
 * seconds while an application is running (router.refresh polling). Without
 * this, watching one application would quietly spend the visitor's credits.
 * One web replica, so a process-local map is enough.
 */
const SEARCH_TTL_MS = 5 * 60 * 1000
const searchCache = new Map<string, { at: number; result: JobSearchResult }>()

export async function searchProductionJobsCached(
  apiKey: string,
  filters: JobFilters,
): Promise<JobSearchResult> {
  // Every filter is in the key — a facet click must never be served the
  // previous selection's page.
  const cacheKey = JSON.stringify([keyHash(apiKey), filtersCacheKey(filters)])
  const hit = searchCache.get(cacheKey)
  if (hit && Date.now() - hit.at < SEARCH_TTL_MS) return hit.result
  const result = await searchProductionJobs(apiKey, filters)
  searchCache.set(cacheKey, { at: Date.now(), result })
  if (searchCache.size > 500) {
    for (const [key, value] of searchCache)
      if (Date.now() - value.at >= SEARCH_TTL_MS) searchCache.delete(key)
    while (searchCache.size > 500) searchCache.delete(searchCache.keys().next().value!)
  }
  return result
}

function keyHash(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('base64url')
}

const companySchema = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string().nullish(),
  description: z.string().nullish(),
  website: z.string().nullish(),
  logo_url: z.string().nullish(),
  linkedin_url: z.string().nullish(),
  crunchbase_url: z.string().nullish(),
  headquarters_location: z.string().nullish(),
  headquarters_city: z.string().nullish(),
  founding_year: z.string().nullish(),
  company_size: z.string().nullish(),
  revenue: z.string().nullish(),
  industries: z.array(z.string()).nullish(),
  categories: z.array(z.string()).nullish(),
  ipo_status: z.string().nullish(),
  company_type: z.string().nullish(),
  stock_symbol: z.string().nullish(),
  funding_stage: z.string().nullish(),
  total_funding: z.string().nullish(),
  funds_total_formatted: z.string().nullish(),
  investors: z.array(z.string()).nullish(),
  tech_stack: z.array(z.object({ name: z.string().nullish() })).nullish(),
  technologies: z.array(z.string()).nullish(),
})

export interface CompanyProfile {
  id: string
  name: string
  about?: string
  website?: string
  logoUrl?: string
  linkedinUrl?: string
  crunchbaseUrl?: string
  facts: { label: string; value: string }[]
  industries: string[]
  categories: string[]
  investors: string[]
  techStack: string[]
}

/** "series_b" → "Series B". */
function titleCase(value: string): string {
  return value.replace(/[_-]+/g, ' ').trim().replace(/\b\p{L}/gu, (c) => c.toUpperCase())
}

function sizeLabel(value: string): string {
  return /employees?/i.test(value) ? value : `${value} employees`
}

export function toCompanyProfile(dto: z.infer<typeof companySchema>): CompanyProfile {
  const text = (value: string | null | undefined) => value?.trim() || undefined
  const facts: { label: string; value: string }[] = []
  const add = (label: string, value: string | undefined) => value && facts.push({ label, value })
  add('Headcount', text(dto.company_size) && sizeLabel(dto.company_size!.trim()))
  add('Founded', text(dto.founding_year))
  add('Headquarters', text(dto.headquarters_location) ?? text(dto.headquarters_city))
  add('Funding stage', text(dto.funding_stage) && titleCase(dto.funding_stage!))
  add('Total raised', text(dto.funds_total_formatted) ?? text(dto.total_funding))
  add('Revenue', text(dto.revenue))
  add(
    'Ownership',
    text(dto.stock_symbol)
      ? `Public · ${dto.stock_symbol}`
      : text(dto.ipo_status) && humanize(dto.ipo_status),
  )
  add('Company type', text(dto.company_type) && humanize(dto.company_type))
  const stack = [
    ...(dto.tech_stack ?? []).map((t) => t.name ?? ''),
    ...(dto.technologies ?? []),
  ]
  const about = plainText(dto.summary || dto.description || '')
  const website = text(dto.website)
  return {
    id: dto.id,
    name: dto.name,
    about: about ? truncate(about, 600) : undefined,
    website: website ? httpsUrl(/^https?:/i.test(website) ? website : `https://${website}`) || undefined : undefined,
    logoUrl: httpsUrl(dto.logo_url) || undefined,
    linkedinUrl: httpsUrl(dto.linkedin_url) || undefined,
    crunchbaseUrl: httpsUrl(dto.crunchbase_url) || undefined,
    facts,
    industries: dto.industries ?? [],
    categories: (dto.categories ?? []).map(valueLabel),
    investors: (dto.investors ?? []).filter(Boolean).slice(0, 6),
    techStack: [...new Set(stack.map((t) => t.trim()).filter(Boolean))].slice(0, 14),
  }
}

/**
 * The full company profile — headcount, funding, investors, HQ, tech stack —
 * which job search only carries a summary of. Free, so it is fetched per job
 * page and cached an hour per company.
 */
const COMPANY_TTL_MS = 60 * 60 * 1000
const companyCache = new Map<string, { at: number; profile: CompanyProfile | null }>()

export async function getCompanyProfile(
  apiKey: string,
  companyId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CompanyProfile | null> {
  if (!isProductionJobId(companyId)) return null
  const hit = companyCache.get(companyId)
  if (hit && Date.now() - hit.at < COMPANY_TTL_MS) return hit.profile
  const response = await call(apiKey, `/api/companies/${companyId}`, fetchImpl)
  if (!response.ok && response.status !== 404)
    throw new JobsApiError('unavailable', `Company lookup failed (HTTP ${response.status}).`)
  const profile = response.ok ? toCompanyProfile(companySchema.parse(await response.json())) : null
  companyCache.set(companyId, { at: Date.now(), profile })
  if (companyCache.size > 1000) companyCache.delete(companyCache.keys().next().value!)
  return profile
}

export async function getProductionJob(
  apiKey: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Job> {
  if (!isProductionJobId(id)) throw new JobsApiError('not_found', 'Job not found.')
  const response = await call(apiKey, `/api/jobs/${id}`, fetchImpl)
  if (response.status === 404) throw new JobsApiError('not_found', 'Job not found.')
  if (!response.ok)
    throw new JobsApiError('unavailable', `Job lookup failed (HTTP ${response.status}).`)
  return toJob(jobSchema.parse(await response.json()), await supportedAts())
}

/** Cheap shape check before any network call. */
export function looksLikeApiKey(value: string): boolean {
  return /^jbe_(live|test)_[A-Za-z0-9_-]{20,}$/.test(value)
}

/**
 * Prove a key works before storing it: a free authenticated job lookup
 * (401 = bad key; 404 for the nil id = fine), then the Auto Apply list route,
 * which is what applications will call. Whether the account has Auto Apply
 * enabled is only checked by Jobo at create time, so that surfaces on the
 * first application instead.
 */
export async function verifyApiKey(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!looksLikeApiKey(apiKey))
    return { ok: false, error: 'That does not look like a Jobo API key — they start with jbe_live_ or jbe_test_.' }
  try {
    const probe = await call(apiKey, '/api/jobs/00000000-0000-0000-0000-000000000000', fetchImpl)
    if (!probe.ok && probe.status !== 404)
      return { ok: false, error: `Jobo could not check this key (HTTP ${probe.status}). Please try again.` }
    const autoApply = await call(apiKey, '/api/auto-apply/applications?limit=1', fetchImpl)
    if (autoApply.status === 403)
      return { ok: false, error: 'This key cannot use Auto Apply. Check its permissions in the Jobo dashboard.' }
    if (!autoApply.ok)
      return { ok: false, error: `Jobo could not check Auto Apply access (HTTP ${autoApply.status}). Please try again.` }
    return { ok: true }
  } catch (error) {
    if (error instanceof JobsApiError && error.kind !== 'insufficient_credits')
      return { ok: false, error: error.message }
    // Out of search credits still means the key itself is valid.
    if (error instanceof JobsApiError) return { ok: true }
    return { ok: false, error: 'Jobo could not check this key. Please try again.' }
  }
}
