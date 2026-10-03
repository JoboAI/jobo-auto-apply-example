import { createHash } from 'node:crypto'
import { createClient, JoboAPIError } from '@jobo-ai/autoapply'
import { z } from 'zod'
import { config } from '@/lib/config'
import type { Job } from '@/lib/jobs-types'
import { isoCountryCode, isProductionJobId } from '@/lib/jobs'
import { atsLogo, supportedAts, type SupportedAts } from './supported-ats'
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

export type JobsErrorKind = 'unauthorized' | 'insufficient_credits' | 'not_found' | 'unavailable'

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

const qualificationSchema = z
  .object({
    skills: z.array(z.object({ name: z.string(), type: z.string().nullish() })).nullish(),
    education: z.array(z.string()).nullish(),
    certifications: z.array(z.string()).nullish(),
  })
  .nullish()

const jobSchema = z.object({
  id: z.string(),
  external_id: z.string().nullish(),
  title: z.string(),
  normalized_title: z.string().nullish(),
  company: z
    .object({
      id: z.string().nullish(),
      name: z.string().nullish(),
      logo_url: z.string().nullish(),
      website: z.string().nullish(),
      summary: z.string().nullish(),
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
  valid_through: z.string().nullish(),
  updated_at: z.string().nullish(),
  qualifications: z
    .object({ must_have: qualificationSchema, preferred: qualificationSchema })
    .nullish(),
  benefits: z.array(z.string()).nullish(),
  is_work_auth_required: z.boolean().nullish(),
  is_h1b_sponsor: z.boolean().nullish(),
  is_clearance_required: z.boolean().nullish(),
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
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const mark = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)
  return mark.toUpperCase()
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
}

function plainText(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' '))
    .replace(/[#*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export type DescriptionBlock =
  { kind: 'heading' | 'paragraph'; text: string } | { kind: 'list'; items: string[] }

/**
 * A job description — sanitized HTML from the API, sometimes markdown or
 * plain text — as headings, paragraphs and bullet lists. Rendered as React
 * text, so no markup from the posting ever reaches the page as HTML.
 */
export function descriptionBlocks(value: string | null | undefined): DescriptionBlock[] {
  if (!value?.trim()) return []
  const marked = value
    .replace(/\r\n?/g, '\n')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    // A paragraph that is only bold text is a section heading in most postings.
    .replace(/<p\b[^>]*>\s*<(strong|b)\b[^>]*>([^<]{1,100})<\/\1>\s*<\/p>/gi, '\n\n# $2\n\n')
    .replace(/<h[1-6]\b[^>]*>/gi, '\n\n# ')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(h[1-6]|p|div|ul|ol|section|article|blockquote|table|tr)\s*>/gi, '\n\n')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  const blocks: DescriptionBlock[] = []
  let paragraph: string[] = []
  const clean = (text: string) =>
    decodeEntities(text)
      .replace(/\*\*|__|`/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  const flush = () => {
    const text = clean(paragraph.join(' '))
    if (text) blocks.push({ kind: 'paragraph', text })
    paragraph = []
  }
  for (const raw of marked.split('\n')) {
    const line = raw.trim()
    const heading = /^#{1,6}\s+(.+)$/.exec(line) ?? /^\*\*([^*]{1,100})\*\*:?$/.exec(line)
    const item = /^(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line)
    if (!line) flush()
    else if (heading) {
      flush()
      const text = clean(heading[1]).replace(/:$/, '')
      if (text) blocks.push({ kind: 'heading', text })
    } else if (item) {
      flush()
      const text = clean(item[1])
      const last = blocks[blocks.length - 1]
      if (!text) continue
      if (last?.kind === 'list') last.items.push(text)
      else blocks.push({ kind: 'list', items: [text] })
    } else paragraph.push(line)
  }
  flush()
  return blocks
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

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  CAD: 'CA$',
  AUD: 'A$',
}
const PERIODS: Record<string, string> = {
  yearly: '/yr',
  monthly: '/mo',
  weekly: '/wk',
  daily: '/day',
  hourly: '/hr',
}

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
    sourceLogoUrl: ats?.logoUrl ?? atsLogo(dto.source),
    listingUrl: httpsUrl(dto.listing_url) || undefined,
    logoUrl: httpsUrl(dto.company?.logo_url) || undefined,
    countryCode: isoCountryCode(first?.country),
    companyId: dto.company?.id ?? undefined,
    companyWebsite: dto.company?.website ?? undefined,
    industries: dto.company?.industries?.filter(Boolean) ?? [],
    companyCategories: (dto.company?.categories ?? []).map(valueLabel),
    workModel: dto.workplace_type ?? undefined,
    experienceLevel: dto.experience_level ?? undefined,
    salary: salaryRange(dto.compensation),
    postedAgo: postedAgo(dto.date_posted),
    skills: (dto.qualifications?.must_have?.skills ?? [])
      .map((s) => s.name)
      .filter(Boolean)
      .slice(0, 8),
  }
}

export interface QualificationSet {
  skills: string[]
  softSkills: string[]
  education: string[]
  certifications: string[]
}

/**
 * Everything `GET /api/jobs/{id}` carries beyond the feed card, for the job
 * page only (search results stay on the lean `Job`).
 */
export interface JobDetail {
  normalizedTitle?: string
  summary?: string
  description: DescriptionBlock[]
  companySummary?: string
  locations: { label: string; flag?: string }[]
  pay?: string
  postedOn?: string
  closesOn?: string
  updatedAgo?: string
  externalId?: string
  mustHave: QualificationSet
  preferred: QualificationSet
  benefits: string[]
  eligibility: { label: string; value: boolean }[]
}

/** "Oct 2, 2026", in UTC so the server and tests agree. */
export function formatDate(value: string | null | undefined): string | undefined {
  const at = value ? Date.parse(value) : NaN
  if (!Number.isFinite(at)) return undefined
  return new Date(at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

const PERIOD_WORDS: Record<string, string> = {
  yearly: 'per year',
  monthly: 'per month',
  weekly: 'per week',
  daily: 'per day',
  hourly: 'per hour',
}

/** "$120,000 – $165,000 USD per year": the exact figures the employer published. */
export function fullPay(pay: JobDto['compensation']): string | undefined {
  const min = pay?.min ?? undefined,
    max = pay?.max ?? undefined
  if (!min && !max) return undefined
  const code = pay?.currency?.toUpperCase() ?? ''
  const symbol = CURRENCY_SYMBOLS[code] ?? ''
  const amount = (n: number) =>
    `${symbol}${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  const range =
    min && max && min !== max ? `${amount(min)} – ${amount(max)}` : amount((min ?? max)!)
  const period = PERIOD_WORDS[pay?.period?.toLowerCase() ?? '']
  return [range, code, period].filter(Boolean).join(' ')
}

/** "GB" → 🇬🇧 */
function flag(code: string | undefined): string | undefined {
  return code
    ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
    : undefined
}

function qualificationSet(bucket: z.infer<typeof qualificationSchema>): QualificationSet {
  const skills = bucket?.skills ?? []
  const names = (soft: boolean) => [
    ...new Set(
      skills
        .filter((s) => (s.type?.toLowerCase() === 'soft') === soft)
        .map((s) => s.name.trim())
        .filter(Boolean),
    ),
  ]
  const list = (values: string[] | null | undefined) => [
    ...new Set((values ?? []).map((v) => v.trim()).filter(Boolean)),
  ]
  return {
    skills: names(false),
    softSkills: names(true),
    education: list(bucket?.education),
    certifications: list(bucket?.certifications),
  }
}

export function toJobDetail(dto: JobDto, now = Date.now()): JobDetail {
  const text = (value: string | null | undefined) => value?.trim() || undefined
  const seen = new Set<string>()
  const locations: JobDetail['locations'] = []
  for (const l of dto.locations ?? []) {
    const label =
      l.location?.trim() || [l.city, l.region, l.country].filter((v) => v?.trim()).join(', ')
    if (!label || seen.has(label.toLowerCase())) continue
    seen.add(label.toLowerCase())
    locations.push({ label, flag: flag(isoCountryCode(l.country)) })
  }
  const eligibility: JobDetail['eligibility'] = []
  const flagRow = (label: string, value: boolean | null | undefined) =>
    typeof value === 'boolean' && eligibility.push({ label, value })
  flagRow('Work authorization required', dto.is_work_auth_required)
  flagRow('Sponsors H-1B visas', dto.is_h1b_sponsor)
  flagRow('Security clearance required', dto.is_clearance_required)
  const normalized = text(dto.normalized_title)
  const summary = text(dto.summary) && plainText(dto.summary!)
  const updated = postedAgo(dto.updated_at, now)
  return {
    normalizedTitle:
      normalized && normalized.toLowerCase() !== dto.title.trim().toLowerCase()
        ? normalized
        : undefined,
    summary: summary || undefined,
    description: descriptionBlocks(dto.description),
    companySummary: text(dto.company?.summary) && plainText(dto.company!.summary!),
    locations,
    pay: fullPay(dto.compensation),
    postedOn: formatDate(dto.date_posted),
    closesOn: formatDate(dto.valid_through),
    updatedAgo: updated && (updated === 'Today' ? 'today' : updated),
    externalId: text(dto.external_id),
    mustHave: qualificationSet(dto.qualifications?.must_have),
    preferred: qualificationSet(dto.qualifications?.preferred),
    benefits: [...new Set((dto.benefits ?? []).map((b) => b.trim()).filter(Boolean))],
    eligibility,
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
    throw new JobsApiError(
      'unauthorized',
      'Jobo rejected this API key. Reconnect with a valid key.',
    )
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
  const request = toSearchBody(
    filters,
    supported.map((a) => a.id),
    PAGE_SIZE,
  )
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
 * A process-local map is enough for one web process; with several, use a
 * shared cache (Redis, or a table) instead.
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

const str = z.string().nullish()
const companySchema = z.object({
  id: z.string(),
  name: z.string(),
  legal_name: str,
  summary: str,
  description: str,
  website: str,
  careers_url: str,
  ats_provider: str,
  logo_url: str,
  linkedin_url: str,
  twitter_url: str,
  facebook_url: str,
  instagram_url: str,
  angellist_url: str,
  youtube_url: str,
  github_url: str,
  crunchbase_url: str,
  headquarters_location: str,
  headquarters_city: str,
  headquarters_region: str,
  country_code: str,
  founding_year: str,
  company_size: str,
  revenue: str,
  is_agency: z.boolean().nullish(),
  industries: z.array(z.string()).nullish(),
  primary_industry: str,
  categories: z.array(z.string()).nullish(),
  operating_status: str,
  ipo_status: str,
  company_type: str,
  stock_symbol: str,
  stock_exchange: str,
  is_acquired: z.boolean().nullish(),
  acquired_by_company: str,
  funding_stage: str,
  total_funding: str,
  funds_total_formatted: str,
  investors: z.array(z.string()).nullish(),
  funding_rounds: z
    .array(
      z.object({
        investment_type: str,
        announced_on: str,
        raised_amount: str,
        post_money_valuation: str,
        lead_investor: str,
      }),
    )
    .nullish(),
  founders: z.array(z.string()).nullish(),
  leadership: z
    .array(z.object({ name: str, title: str, linkedin_url: str, avatar_url: str }))
    .nullish(),
  ratings: z
    .array(
      z.object({
        source: str,
        rating: z.union([z.string(), z.number()]).nullish(),
        url: str,
        review_count: z.number().nullish(),
      }),
    )
    .nullish(),
  press_references: z
    .array(z.object({ url: str, posted_on: str, title: str, publisher: str }))
    .nullish(),
  products: z.array(z.object({ name: str, description: str })).nullish(),
  acquisitions: z.array(z.object({ acquiree_name: str, title: str })).nullish(),
  subsidiary_list: z.array(z.string()).nullish(),
  tech_stack: z.array(z.object({ name: z.string().nullish() })).nullish(),
  technologies: z.array(z.string()).nullish(),
})

/** The networks a company profile can link to, in display order. */
export const COMPANY_LINK_KINDS = [
  'website',
  'careers',
  'linkedin',
  'twitter',
  'github',
  'crunchbase',
  'angellist',
  'youtube',
  'instagram',
  'facebook',
] as const
export type CompanyLinkKind = (typeof COMPANY_LINK_KINDS)[number]

export interface CompanyProfile {
  id: string
  name: string
  legalName?: string
  /** One-line blurb, shown above `about` when both exist. */
  tagline?: string
  about?: string
  website?: string
  logoUrl?: string
  links: { kind: CompanyLinkKind; href: string }[]
  /** ATS provider id the company hires through, when detected. */
  atsProvider?: string
  facts: { label: string; value: string }[]
  industries: string[]
  categories: string[]
  investors: string[]
  fundingRounds: {
    type?: string
    date?: string
    amount?: string
    valuation?: string
    lead?: string
  }[]
  founders: string[]
  leadership: { name: string; title?: string; linkedinUrl?: string; avatarUrl?: string }[]
  ratings: { source: string; rating: string; reviewCount?: number; url?: string }[]
  press: { title: string; publisher?: string; date?: string; url?: string }[]
  products: { name: string; description?: string }[]
  acquisitions: string[]
  subsidiaries: string[]
  techStack: string[]
}

/** "series_b" → "Series B". */
function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase())
}

function sizeLabel(value: string): string {
  return /employees?/i.test(value) ? value : `${value} employees`
}

function uniqueText(values: (string | null | undefined)[], max: number): string[] {
  return [...new Set(values.map((v) => v?.trim() ?? '').filter(Boolean))].slice(0, max)
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
      ? `Public · ${[text(dto.stock_exchange)?.toUpperCase(), dto.stock_symbol!.trim()].filter(Boolean).join(': ')}`
      : text(dto.ipo_status) && humanize(dto.ipo_status),
  )
  add('Company type', text(dto.company_type) && humanize(dto.company_type))
  add('Industry', text(dto.primary_industry))
  add(
    'Acquired by',
    dto.is_acquired || text(dto.acquired_by_company)
      ? (text(dto.acquired_by_company) ?? 'Yes')
      : undefined,
  )
  add('Status', dto.operating_status?.toLowerCase() === 'closed' ? 'Closed' : undefined)
  add('Agency', dto.is_agency ? 'Staffing / recruiting agency' : undefined)
  const stack = [...(dto.tech_stack ?? []).map((t) => t.name ?? ''), ...(dto.technologies ?? [])]
  const summary = plainText(dto.summary || '')
  const description = plainText(dto.description || '')
  const about = description || summary
  const website = text(dto.website)
  const href = (value: string | null | undefined) => httpsUrl(value) || undefined
  const linkUrls: Record<CompanyLinkKind, string | undefined> = {
    website: website ? href(/^https?:/i.test(website) ? website : `https://${website}`) : undefined,
    careers: href(dto.careers_url),
    linkedin: href(dto.linkedin_url),
    twitter: href(dto.twitter_url),
    github: href(dto.github_url),
    crunchbase: href(dto.crunchbase_url),
    angellist: href(dto.angellist_url),
    youtube: href(dto.youtube_url),
    instagram: href(dto.instagram_url),
    facebook: href(dto.facebook_url),
  }
  const legalName = text(dto.legal_name)
  return {
    id: dto.id,
    name: dto.name,
    legalName:
      legalName && legalName.toLowerCase() !== dto.name.trim().toLowerCase()
        ? legalName
        : undefined,
    tagline:
      description && summary && !description.startsWith(summary.slice(0, 60))
        ? truncate(summary, 220)
        : undefined,
    about: about ? truncate(about, 1500) : undefined,
    website: linkUrls.website,
    logoUrl: httpsUrl(dto.logo_url) || undefined,
    links: COMPANY_LINK_KINDS.flatMap((kind) =>
      linkUrls[kind] ? [{ kind, href: linkUrls[kind]! }] : [],
    ),
    atsProvider: text(dto.ats_provider)?.toLowerCase(),
    facts,
    industries: dto.industries ?? [],
    categories: (dto.categories ?? []).map(valueLabel),
    investors: uniqueText(dto.investors ?? [], 8),
    fundingRounds: (dto.funding_rounds ?? [])
      .filter((r) => r.investment_type || r.raised_amount)
      .sort(
        (a, b) => (Date.parse(b.announced_on ?? '') || 0) - (Date.parse(a.announced_on ?? '') || 0),
      )
      .slice(0, 6)
      .map((r) => ({
        type: text(r.investment_type) && titleCase(r.investment_type!),
        date: formatDate(r.announced_on) ?? text(r.announced_on),
        amount: text(r.raised_amount),
        valuation: text(r.post_money_valuation),
        lead: text(r.lead_investor),
      })),
    founders: uniqueText(dto.founders ?? [], 6),
    leadership: (dto.leadership ?? [])
      .filter((l) => text(l.name))
      .slice(0, 6)
      .map((l) => ({
        name: l.name!.trim(),
        title: text(l.title),
        linkedinUrl: href(l.linkedin_url),
        avatarUrl: href(l.avatar_url),
      })),
    ratings: (dto.ratings ?? []).flatMap((r) => {
      const rating = r.rating == null ? '' : String(r.rating).trim()
      return text(r.source) && rating
        ? [
            {
              source: titleCase(r.source!),
              rating,
              reviewCount: r.review_count ?? undefined,
              url: href(r.url),
            },
          ]
        : []
    }),
    press: (dto.press_references ?? [])
      .filter((p) => text(p.title))
      .slice(0, 5)
      .map((p) => ({
        title: p.title!.trim(),
        publisher: text(p.publisher),
        date: formatDate(p.posted_on),
        url: href(p.url),
      })),
    products: (dto.products ?? [])
      .filter((p) => text(p.name))
      .slice(0, 6)
      .map((p) => ({
        name: p.name!.trim(),
        description: text(p.description) && truncate(plainText(p.description!), 200),
      })),
    acquisitions: uniqueText(
      (dto.acquisitions ?? []).map((a) => a.acquiree_name ?? a.title),
      8,
    ),
    subsidiaries: uniqueText(dto.subsidiary_list ?? [], 8),
    techStack: [...new Set(stack.map((t) => t.trim()).filter(Boolean))].slice(0, 20),
  }
}

/**
 * The full company profile — headcount, funding, investors, HQ, tech stack —
 * which job search only carries a summary of. Free, so it is fetched per job
 * page and cached an hour per key + company (a key that stops working must
 * stop seeing data).
 */
const COMPANY_TTL_MS = 60 * 60 * 1000
const companyCache = new Map<string, { at: number; profile: CompanyProfile | null }>()

export async function getCompanyProfile(
  apiKey: string,
  companyId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CompanyProfile | null> {
  if (!isProductionJobId(companyId)) return null
  const cacheKey = `${keyHash(apiKey)}:${companyId}`
  const hit = companyCache.get(cacheKey)
  if (hit && Date.now() - hit.at < COMPANY_TTL_MS) return hit.profile
  const response = await call(apiKey, `/api/companies/${companyId}`, fetchImpl)
  if (!response.ok && response.status !== 404)
    throw new JobsApiError('unavailable', `Company lookup failed (HTTP ${response.status}).`)
  const profile = response.ok ? toCompanyProfile(companySchema.parse(await response.json())) : null
  companyCache.set(cacheKey, { at: Date.now(), profile })
  if (companyCache.size > 1000) companyCache.delete(companyCache.keys().next().value!)
  return profile
}

export async function getProductionJob(
  apiKey: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Job> {
  return (await getProductionJobDetail(apiKey, id, fetchImpl)).job
}

/**
 * One job with everything the API returned: the feed-shaped `Job`, the full
 * `JobDetail` for the job page, and the raw JSON response, which the page
 * shows as-is.
 */
export async function getProductionJobDetail(
  apiKey: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ job: Job; detail: JobDetail; raw: unknown; url: string }> {
  if (!isProductionJobId(id)) throw new JobsApiError('not_found', 'Job not found.')
  const response = await call(apiKey, `/api/jobs/${id}`, fetchImpl)
  if (response.status === 404) throw new JobsApiError('not_found', 'Job not found.')
  if (!response.ok)
    throw new JobsApiError('unavailable', `Job lookup failed (HTTP ${response.status}).`)
  const raw: unknown = await response.json()
  const dto = jobSchema.parse(raw)
  return {
    job: toJob(dto, await supportedAts()),
    detail: toJobDetail(dto),
    raw,
    url: `${apiBase()}/api/jobs/${id}`,
  }
}

/** Cheap shape check before any network call. */
function looksLikeApiKey(value: string): boolean {
  return /^jbe_(live|test)_[A-Za-z0-9_-]{20,}$/.test(value)
}

/**
 * Prove a key works before storing it. First a free authenticated job lookup
 * (401 = bad key; 404 for the nil id = fine; 402 = no search credits, but
 * the key itself is valid), then the Auto Apply list route through the SDK,
 * which is what applications will call. Whether the account has Auto Apply
 * enabled is only checked by Jobo at create time, so that surfaces on the
 * first application instead.
 */
export async function verifyApiKey(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!looksLikeApiKey(apiKey))
    return {
      ok: false,
      error: 'That does not look like a Jobo API key — they start with jbe_live_ or jbe_test_.',
    }
  try {
    const probe = await call(apiKey, '/api/jobs/00000000-0000-0000-0000-000000000000', fetchImpl)
    if (!probe.ok && probe.status !== 404)
      return {
        ok: false,
        error: `Jobo could not check this key (HTTP ${probe.status}). Please try again.`,
      }
  } catch (error) {
    if (!(error instanceof JobsApiError))
      return { ok: false, error: 'Jobo could not check this key. Please try again.' }
    if (error.kind !== 'insufficient_credits') return { ok: false, error: error.message }
  }
  try {
    await createClient({
      apiKey,
      baseUrl: apiBase(),
      fetch: fetchImpl,
      maxRetries: 0,
    }).applications.list({
      limit: 1,
    })
    return { ok: true }
  } catch (error) {
    if (!(error instanceof JoboAPIError))
      return { ok: false, error: 'Jobo could not check Auto Apply access. Please try again.' }
    if (error.status === 401)
      return { ok: false, error: 'Jobo rejected this API key. Reconnect with a valid key.' }
    if (error.status === 403)
      return {
        ok: false,
        error: 'This key cannot use Auto Apply. Check its permissions in the Jobo dashboard.',
      }
    return {
      ok: false,
      error: `Jobo could not check Auto Apply access (HTTP ${error.status}). Please try again.`,
    }
  }
}
