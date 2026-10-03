import { createHash } from 'node:crypto'
import { createClient, JoboAPIError } from '@jobo-ai/autoapply'
import { z } from 'zod'
import { config } from '@/lib/config'
import type { Job } from '@/lib/jobs-types'
import { isProductionJobId } from '@/lib/jobs'
import { supportedAts } from './supported-ats'
import { jobSchema, toJob, toJobDetail, type JobDetail } from './job-format'
import { companySchema, toCompanyProfile, type CompanyProfile } from './company-profile'
import { filtersCacheKey, toSearchBody, type Facets, type JobFilters } from './job-filters'

/**
 * Production mode's job source: the real Jobo catalog, read with the
 * VISITOR's API key (never the deployment's). The response shapes and their
 * mapping live in job-format.ts and company-profile.ts.
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
