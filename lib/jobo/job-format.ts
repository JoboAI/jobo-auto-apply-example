import { z } from 'zod'
import type { Job } from '@/lib/jobs-types'
import { isoCountryCode } from '@/lib/jobs'
import { atsLogo, type SupportedAts } from './supported-ats'
import { valueLabel } from './job-filters'

/**
 * The Jobs API's job shape (validated with zod) and how this app turns it
 * into what it renders: the feed's `Job` and the job page's `JobDetail`.
 * Pure functions, no network: lib/jobo/jobs-api.ts does the fetching.
 */

const qualificationSchema = z
  .object({
    skills: z.array(z.object({ name: z.string(), type: z.string().nullish() })).nullish(),
    education: z.array(z.string()).nullish(),
    certifications: z.array(z.string()).nullish(),
  })
  .nullish()

export const jobSchema = z.object({
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

export function plainText(value: string): string {
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

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max).replace(/\s+\S*$/, '')}…`
}

export function humanize(value: string | null | undefined): string {
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

export function httpsUrl(value: string | null | undefined): string {
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
