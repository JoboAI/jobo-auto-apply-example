import { beforeEach, describe, expect, it } from 'vitest'
import {
  getCompanyProfile,
  getProductionJob,
  JobsApiError,
  postedAgo,
  salaryRange,
  searchProductionJobs,
  toJob,
  verifyApiKey,
} from '@/lib/jobo/jobs-api'
import { parseFilters } from '@/lib/jobo/job-filters'
import { FALLBACK_ATS, resetSupportedAtsCache, supportedAts } from '@/lib/jobo/supported-ats'
import { isProductionJobId, validProductionTarget } from '@/lib/jobs'

process.env.JOBO_API_KEY = 'jbe_test_deployment_fixture'
process.env.OPENROUTER_API_KEY = 'fixture'
process.env.RESUME_URL_SIGNING_SECRET = 'fixture-signing-secret-with-32-characters'
process.env.JOBO_API_BASE_URL = 'https://connect.example.test'
process.env.JOBO_STATUS_URL = 'https://status.example.test/uptime'

const KEY = 'jbe_live_abcdefghijklmnopqrstu_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG'
const ID = '3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'

const status = {
  auto_apply_providers: [
    { provider_id: 'greenhouse', display_name: 'Greenhouse' },
    { provider_id: 'jobosandbox', display_name: 'Sandbox' },
    { provider_id: 'lever', display_name: 'Lever' },
  ],
}

function dto(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    title: 'Backend Engineer',
    company: { name: 'Acme Robotics', logo_url: 'https://cdn.example.test/acme.png' },
    description: '<p>Build <b>APIs</b> &amp; services.</p>',
    summary: null,
    listing_url: 'https://job-boards.greenhouse.io/acme/jobs/1',
    apply_url: 'https://job-boards.greenhouse.io/acme/jobs/1#app',
    locations: [{ location: 'London, UK', city: 'London', region: null, country: 'UK' }],
    employment_type: 'full_time',
    workplace_type: 'hybrid',
    source: 'greenhouse',
    responsibilities: ['Ship things'],
    ...overrides,
  }
}

type Call = { url: string; key: string | null; method: string; body: unknown }
function fakeFetch(routes: Record<string, () => Response>, calls: Call[] = []) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({
      url,
      key: new Headers(init?.headers).get('x-api-key'),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    for (const [prefix, respond] of Object.entries(routes))
      if (url.startsWith(prefix)) return respond()
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}
const json = (body: unknown, status = 200) =>
  () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => resetSupportedAtsCache())

describe('supported ATS list', () => {
  it('drops the sandbox provider from the live list', async () => {
    const list = await supportedAts(fakeFetch({ 'https://status.example.test': json(status) }))
    expect(list.map((a) => a.id)).toEqual(['greenhouse', 'lever'])
  })
  it('falls back to the known list when the status API is down', async () => {
    const list = await supportedAts(fakeFetch({ 'https://status.example.test': json({}, 503) }))
    expect(list).toEqual([...FALLBACK_ATS])
  })
})

describe('catalog jobs', () => {
  it('maps a catalog job onto the demo shape', () => {
    const job = toJob(dto(), [{ id: 'greenhouse', name: 'Greenhouse' }])
    expect(job).toMatchObject({
      slug: ID,
      company: 'Acme Robotics',
      mark: 'AR',
      role: 'Backend Engineer',
      location: 'London, UK',
      department: 'Greenhouse',
      employmentType: 'Full-time',
      about: 'Build APIs & services.',
      available: true,
      production: true,
      source: 'greenhouse',
      countryCode: 'GB',
    })
  })
  it('marks unsupported or URL-less jobs unavailable and ignores non-ISO countries', () => {
    expect(toJob(dto({ source: 'icims' }), [{ id: 'greenhouse', name: 'Greenhouse' }]).available).toBe(false)
    expect(toJob(dto({ apply_url: 'http://insecure.test' }), [{ id: 'greenhouse', name: 'Greenhouse' }]).available).toBe(false)
    expect(toJob(dto({ locations: [{ country: 'United Kingdom' }] }), []).countryCode).toBeUndefined()
  })
  it('searches only supported ATSes with every filter, on the visitor’s key', async () => {
    const calls: Call[] = []
    const fetchImpl = fakeFetch(
      {
        'https://status.example.test': json(status),
        'https://connect.example.test/api/jobs/search': json({
          jobs: [dto()],
          total: 40,
          page: 2,
          total_pages: 2,
          facets: { industries: [{ key: 'Fintech', count: 812 }] },
          warnings: [
            { code: 'companies_unmatched', message: 'No company matched nope.example' },
            { code: 'unknown_request_fields', message: 'Ignored unrecognised request fields: x.' },
          ],
          filters: {
            companies: {
              matched: [{ query: 'stripe.com', companies: [{ id: ID, name: 'Stripe' }] }],
              unmatched: ['nope.example'],
            },
          },
        }),
      },
      calls,
    )
    await supportedAts(fetchImpl)
    const filters = parseFilters({
      q: ' rust ',
      loc: 'Berlin',
      co: ['stripe.com', 'nope.example'],
      ind: ['Fintech', '-HR & Staffing'],
      cat: 'saas',
      wm: 'remote',
      page: '2',
    })
    const result = await searchProductionJobs(KEY, filters, fetchImpl)
    const search = calls.find((c) => c.url.endsWith('/api/jobs/search'))!
    expect(search.method).toBe('POST')
    expect(search.key).toBe(KEY)
    expect(search.body).toMatchObject({
      queries: ['rust'],
      locations: ['Berlin'],
      sources: ['greenhouse', 'lever'],
      companies: { include: ['stripe.com', 'nope.example'] },
      industries: { include: ['Fintech'], exclude: ['HR & Staffing'] },
      company_categories: { include: ['saas'] },
      work_models: ['remote'],
      page: 2,
      page_size: 25,
    })
    expect(result).toMatchObject({
      total: 40,
      page: 2,
      totalPages: 2,
      facets: { industries: [{ key: 'Fintech', count: 812 }] },
      companyNames: { 'stripe.com': 'Stripe' },
      unmatchedCompanies: ['nope.example'],
      warnings: ['Ignored unrecognised request fields: x.'],
      request: { method: 'POST', url: 'https://connect.example.test/api/jobs/search' },
    })
  })
  it('carries company and pay data onto production jobs', () => {
    const job = toJob(
      dto({
        company: {
          id: ID,
          name: 'Acme Robotics',
          industries: ['Robotics'],
          categories: ['b2b', 'saas'],
        },
        workplace_type: 'Remote',
        experience_level: 'Senior',
        compensation: { min: 120000, max: 165000, currency: 'USD', period: 'yearly' },
        qualifications: { must_have: { skills: [{ name: 'Rust' }, { name: 'gRPC' }] } },
      }),
      [{ id: 'greenhouse', name: 'Greenhouse' }],
    )
    expect(job).toMatchObject({
      companyId: ID,
      industries: ['Robotics'],
      companyCategories: ['B2B', 'SaaS'],
      workModel: 'Remote',
      experienceLevel: 'Senior',
      salary: '$120k–$165k/yr',
      skills: ['Rust', 'gRPC'],
    })
  })
  it('formats pay ranges and posting age compactly', () => {
    expect(salaryRange({ min: 45, max: 60, currency: 'GBP', period: 'hourly' })).toBe('£45–£60/hr')
    expect(salaryRange({ min: 95000, max: 95000, currency: 'EUR', period: 'yearly' })).toBe('€95k/yr')
    expect(salaryRange({ min: null, max: null })).toBeUndefined()
    const now = Date.parse('2026-10-02T12:00:00Z')
    expect(postedAgo('2026-10-02T01:00:00Z', now)).toBe('Today')
    expect(postedAgo('2026-09-29T12:00:00Z', now)).toBe('3d ago')
    expect(postedAgo('2026-08-28T12:00:00Z', now)).toBe('5w ago')
    expect(postedAgo(null, now)).toBeUndefined()
  })
  it('reads the free company profile into display facts', async () => {
    const calls: Call[] = []
    const fetchImpl = fakeFetch(
      {
        'https://connect.example.test/api/companies/': json({
          id: ID,
          name: 'Acme Robotics',
          website: 'acme.example',
          company_size: '201-500',
          founding_year: '2015',
          headquarters_location: 'London, United Kingdom',
          funding_stage: 'series_b',
          funds_total_formatted: '$84M',
          investors: ['Index Ventures', 'Seedcamp'],
          tech_stack: [{ name: 'Rust' }, { name: 'Postgres' }],
          technologies: ['Rust', 'Kubernetes'],
          categories: ['b2b'],
          industries: ['Robotics'],
        }),
      },
      calls,
    )
    const company = await getCompanyProfile(KEY, ID, fetchImpl)
    expect(calls[0]).toMatchObject({ url: `https://connect.example.test/api/companies/${ID}`, key: KEY })
    expect(company).toMatchObject({
      name: 'Acme Robotics',
      website: 'https://acme.example/',
      categories: ['B2B'],
      investors: ['Index Ventures', 'Seedcamp'],
      techStack: ['Rust', 'Postgres', 'Kubernetes'],
    })
    expect(company!.facts).toEqual([
      { label: 'Headcount', value: '201-500 employees' },
      { label: 'Founded', value: '2015' },
      { label: 'Headquarters', value: 'London, United Kingdom' },
      { label: 'Funding stage', value: 'Series B' },
      { label: 'Total raised', value: '$84M' },
    ])
    // Cached: a second job page for the same company costs no request.
    await getCompanyProfile(KEY, ID, fetchImpl)
    expect(calls).toHaveLength(1)
  })
  it('maps 401, 402 and 404 to typed errors', async () => {
    const expectKind = async (status: number, kind: string) => {
      const error = await getProductionJob(
        KEY,
        ID,
        fakeFetch({ 'https://connect.example.test': json({}, status) }),
      ).catch((e) => e)
      expect(error).toBeInstanceOf(JobsApiError)
      expect(error.kind).toBe(kind)
    }
    await expectKind(401, 'unauthorized')
    await expectKind(402, 'insufficient_credits')
    await expectKind(404, 'not_found')
  })
  it('only routes UUIDs and https URLs to production', () => {
    expect(isProductionJobId(ID)).toBe(true)
    expect(isProductionJobId('multi-step')).toBe(false)
    expect(validProductionTarget(ID, 'https://jobs.lever.co/acme/1')).toBe(true)
    expect(validProductionTarget(ID, 'http://jobs.lever.co/acme/1')).toBe(false)
    expect(validProductionTarget('multi-step', 'https://jobs.lever.co/acme/1')).toBe(false)
  })
})

describe('connecting a key', () => {
  it('rejects malformed keys without calling Jobo', async () => {
    const calls: Call[] = []
    expect(await verifyApiKey('sk_live_nope', fakeFetch({}, calls))).toMatchObject({ ok: false })
    expect(calls).toHaveLength(0)
  })
  it('accepts a key Jobo authenticates', async () => {
    const fetchImpl = fakeFetch({
      'https://connect.example.test/api/jobs/': json({}, 404),
      'https://connect.example.test/api/auto-apply/applications': json({ data: [] }),
    })
    expect(await verifyApiKey(KEY, fetchImpl)).toEqual({ ok: true })
  })
  it('rejects a key Jobo does not know', async () => {
    const fetchImpl = fakeFetch({ 'https://connect.example.test': json({}, 401) })
    expect(await verifyApiKey(KEY, fetchImpl)).toMatchObject({ ok: false, error: expect.stringMatching(/rejected/) })
  })
})
