import { createHash } from 'node:crypto'
import { z } from 'zod'
import { config } from '@/lib/config'
import type { Job } from '@/lib/jobs-types'
import { isProductionJobId } from '@/lib/jobs'
import { supportedAts, type SupportedAts } from './supported-ats'

/**
 * Production mode's job source: the real Jobo catalog, read with the
 * VISITOR's API key (never the deployment's).
 *
 * Plain fetch rather than a client package — it is two GETs, and the
 * Auto Apply SDK deliberately covers applications only.
 *
 *   GET /api/jobs?sources=…   search, billed per job returned to that key
 *   GET /api/jobs/{id}        one job, free
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
      name: z.string().nullish(),
      logo_url: z.string().nullish(),
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
  source: z.string().nullish(),
  responsibilities: z.array(z.string()).nullish(),
})
export type JobDto = z.infer<typeof jobSchema>

const searchSchema = z.object({
  jobs: z.array(jobSchema),
  total: z.number().nullish(),
  page: z.number().nullish(),
  total_pages: z.number().nullish(),
})

export interface JobSearchResult {
  jobs: Job[]
  total: number
  page: number
  totalPages: number
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
  }
}

async function call(
  apiKey: string,
  path: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const base = config().JOBO_API_BASE_URL.replace(/\/+$/, '')
  let response: Response
  try {
    response = await fetchImpl(`${base}${path}`, {
      headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
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
  params: { q?: string; location?: string; page?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<JobSearchResult> {
  const supported = await supportedAts()
  const query = new URLSearchParams({
    sources: supported.map((a) => a.id).join(','),
    page: String(Math.max(1, Math.floor(params.page ?? 1))),
    page_size: String(PAGE_SIZE),
  })
  if (params.q?.trim()) query.set('q', params.q.trim())
  if (params.location?.trim()) query.set('location', params.location.trim())
  const response = await call(apiKey, `/api/jobs?${query}`, fetchImpl)
  if (!response.ok)
    throw new JobsApiError('unavailable', `Job search failed (HTTP ${response.status}).`)
  const body = searchSchema.parse(await response.json())
  return {
    jobs: body.jobs.map((dto) => toJob(dto, supported)),
    total: body.total ?? body.jobs.length,
    page: body.page ?? 1,
    totalPages: body.total_pages ?? 1,
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
  params: { q?: string; location?: string; page?: number },
): Promise<JobSearchResult> {
  const cacheKey = JSON.stringify([
    createHash('sha256').update(apiKey).digest('base64url'),
    params.q?.trim().toLowerCase() ?? '',
    params.location?.trim().toLowerCase() ?? '',
    params.page ?? 1,
  ])
  const hit = searchCache.get(cacheKey)
  if (hit && Date.now() - hit.at < SEARCH_TTL_MS) return hit.result
  const result = await searchProductionJobs(apiKey, params)
  searchCache.set(cacheKey, { at: Date.now(), result })
  if (searchCache.size > 500) {
    for (const [key, value] of searchCache)
      if (Date.now() - value.at >= SEARCH_TTL_MS) searchCache.delete(key)
    while (searchCache.size > 500) searchCache.delete(searchCache.keys().next().value!)
  }
  return result
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
