import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getCompanyProfile,
  getJob,
  getJobDetail,
  JobsApiError,
  searchJobs,
  verifyApiKey,
} from '@/lib/jobo/jobs-api'
import { environmentForKey, keyMode } from '@/lib/jobo/environment'
import {
  descriptionBlocks,
  fullPay,
  postedAgo,
  salaryRange,
  toJob,
  toJobDetail,
} from '@/lib/jobo/job-format'
import { parseFilters } from '@/lib/jobo/job-filters'
import {
  atsLogo,
  FALLBACK_ATS,
  resetSupportedAtsCache,
  supportedAts,
} from '@/lib/jobo/supported-ats'

process.env.API_KEY_ENCRYPTION_SECRET = 'fixture-encryption-secret-with-32-characters'
process.env.OPENROUTER_API_KEY = 'fixture'
process.env.RESUME_URL_SIGNING_SECRET = 'fixture-signing-secret-with-32-characters'
process.env.JOBO_API_BASE_URL = 'https://connect.example.test'
process.env.JOBO_STATUS_URL = 'https://status.example.test/uptime'

const KEY = 'jbe_live_abcdefghijklmnopqrstu_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG'
const ID = '3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'
const LIVE = environmentForKey(KEY)

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
const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => resetSupportedAtsCache())

describe('supported ATS list', () => {
  it('drops the sandbox provider from the live list', async () => {
    const list = await supportedAts(fakeFetch({ 'https://status.example.test': json(status) }))
    expect(list.map((a) => a.id)).toEqual(['greenhouse', 'lever'])
  })
  it('falls back to the known list when the status API is down', async () => {
    const list = await supportedAts(fakeFetch({ 'https://status.example.test': json({}, 503) }))
    expect(list.map(({ id, name }) => ({ id, name }))).toEqual([...FALLBACK_ATS])
  })
  it('ships a logo file for every ATS Auto Apply supports', async () => {
    const list = await supportedAts(fakeFetch({ 'https://status.example.test': json(status) }))
    expect(list.find((a) => a.id === 'greenhouse')?.logoUrl).toBe('/ats-logos/greenhouse.png')
    for (const ats of FALLBACK_ATS) {
      const logo = atsLogo(ats.id)
      expect(logo, ats.id).toBeDefined()
      expect(existsSync(join(process.cwd(), 'public', logo!)), logo).toBe(true)
    }
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
      source: 'greenhouse',
      countryCode: 'GB',
    })
  })
  it('marks unsupported or URL-less jobs unavailable and ignores non-ISO countries', () => {
    expect(
      toJob(dto({ source: 'icims' }), [{ id: 'greenhouse', name: 'Greenhouse' }]).available,
    ).toBe(false)
    expect(
      toJob(dto({ apply_url: 'http://insecure.test' }), [{ id: 'greenhouse', name: 'Greenhouse' }])
        .available,
    ).toBe(false)
    expect(
      toJob(dto({ locations: [{ country: 'United Kingdom' }] }), []).countryCode,
    ).toBeUndefined()
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
    const result = await searchJobs(LIVE, filters, fetchImpl)
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
  it('reads every job field onto the job page detail', () => {
    const detail = toJobDetail(
      dto({
        external_id: 'REQ-4471',
        normalized_title: 'Software Engineer, Backend',
        summary: 'Own the <b>billing</b> API.',
        company: { name: 'Acme Robotics', summary: 'Robots for warehouses.' },
        locations: [
          { location: 'London, UK', country: 'UK' },
          { city: 'Berlin', region: 'Berlin', country: 'DE' },
          { location: 'london, uk', country: 'GB' },
        ],
        compensation: { min: 120000, max: 165000, currency: 'USD', period: 'yearly' },
        date_posted: '2026-09-28T09:00:00Z',
        valid_through: '2026-10-30T00:00:00Z',
        updated_at: '2026-10-01T12:00:00Z',
        qualifications: {
          must_have: {
            skills: [
              { name: 'Rust', type: 'hard' },
              { name: 'Ownership', type: 'soft' },
              { name: 'Rust', type: 'hard' },
            ],
            education: ["Bachelor's in CS"],
            certifications: [],
          },
          preferred: { skills: [{ name: 'gRPC' }], education: null, certifications: ['AWS SA'] },
        },
        benefits: ['Private health', ' Private health ', '25 days PTO'],
        is_work_auth_required: true,
        is_h1b_sponsor: false,
        is_clearance_required: null,
      }),
      Date.parse('2026-10-03T12:00:00Z'),
    )
    expect(detail).toMatchObject({
      externalId: 'REQ-4471',
      normalizedTitle: 'Software Engineer, Backend',
      summary: 'Own the billing API.',
      companySummary: 'Robots for warehouses.',
      locations: [
        { label: 'London, UK', flag: '🇬🇧' },
        { label: 'Berlin, Berlin, DE', flag: '🇩🇪' },
      ],
      pay: '$120,000 – $165,000 USD per year',
      postedOn: 'Sep 28, 2026',
      closesOn: 'Oct 30, 2026',
      updatedAgo: '2d ago',
      mustHave: {
        skills: ['Rust'],
        softSkills: ['Ownership'],
        education: ["Bachelor's in CS"],
        certifications: [],
      },
      preferred: { skills: ['gRPC'], softSkills: [], education: [], certifications: ['AWS SA'] },
      benefits: ['Private health', '25 days PTO'],
      eligibility: [
        { label: 'Work authorization required', value: true },
        { label: 'Sponsors H-1B visas', value: false },
      ],
    })
    // Same title in another case is not worth a second line.
    expect(
      toJobDetail(dto({ normalized_title: 'backend engineer' })).normalizedTitle,
    ).toBeUndefined()
  })
  it('splits an HTML, markdown or plain description into blocks', () => {
    expect(
      descriptionBlocks(
        '<p><strong>About us</strong></p><p>We build &amp; ship.<br>Daily.</p>' +
          '<h3>You will</h3><ul><li>Design <em>APIs</em></li><li>Review code</li></ul>' +
          '<script>alert(1)</script><p>&lt;b&gt;literal&lt;/b&gt;</p>',
      ),
    ).toEqual([
      { kind: 'heading', text: 'About us' },
      { kind: 'paragraph', text: 'We build & ship. Daily.' },
      { kind: 'heading', text: 'You will' },
      { kind: 'list', items: ['Design APIs', 'Review code'] },
      // Escaped markup stays text: the page renders it, never parses it.
      { kind: 'paragraph', text: '<b>literal</b>' },
    ])
    expect(descriptionBlocks('## Perks:\n- Remote\n* Equity\n\nJoin us\ntoday')).toEqual([
      { kind: 'heading', text: 'Perks' },
      { kind: 'list', items: ['Remote', 'Equity'] },
      { kind: 'paragraph', text: 'Join us today' },
    ])
    expect(descriptionBlocks('  ')).toEqual([])
  })
  it('keeps the raw response alongside the mapped job', async () => {
    const body = dto({ benefits: ['Gym'] })
    const loaded = await getJobDetail(
      LIVE,
      ID,
      fakeFetch({ 'https://connect.example.test/api/jobs/': json(body) }),
    )
    expect(loaded.raw).toEqual(body)
    expect(loaded.url).toBe(`https://connect.example.test/api/jobs/${ID}`)
    expect(loaded.job.sourceLogoUrl).toBe('/ats-logos/greenhouse.png')
    expect(loaded.detail.benefits).toEqual(['Gym'])
  })
  it('formats pay ranges and posting age compactly', () => {
    expect(salaryRange({ min: 45, max: 60, currency: 'GBP', period: 'hourly' })).toBe('£45–£60/hr')
    expect(salaryRange({ min: 95000, max: 95000, currency: 'EUR', period: 'yearly' })).toBe(
      '€95k/yr',
    )
    expect(salaryRange({ min: null, max: null })).toBeUndefined()
    expect(fullPay({ min: 45.5, max: 60, currency: 'GBP', period: 'hourly' })).toBe(
      '£45.5 – £60 GBP per hour',
    )
    expect(fullPay({ min: 90000, max: null, currency: 'CHF', period: null })).toBe('90,000 CHF')
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
    const company = await getCompanyProfile(LIVE, ID, fetchImpl)
    expect(calls[0]).toMatchObject({
      url: `https://connect.example.test/api/companies/${ID}`,
      key: KEY,
    })
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
    await getCompanyProfile(LIVE, ID, fetchImpl)
    expect(calls).toHaveLength(1)
  })
  it('reads links, funding and ratings from the company profile', async () => {
    const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
    const company = await getCompanyProfile(
      LIVE,
      OTHER,
      fakeFetch({
        'https://connect.example.test/api/companies/': json({
          id: OTHER,
          name: 'Globex',
          legal_name: 'Globex Systems, Inc.',
          summary: 'Payments for robots.',
          description: 'Globex builds the payment rails that warehouse robots use.',
          website: 'https://globex.example',
          careers_url: 'https://globex.example/careers',
          ats_provider: 'Greenhouse',
          linkedin_url: 'https://www.linkedin.com/company/globex',
          twitter_url: 'http://twitter.com/globex',
          github_url: 'https://github.com/globex',
          primary_industry: 'Finance',
          stock_symbol: 'GLBX',
          stock_exchange: 'nasdaq',
          funding_rounds: [
            {
              investment_type: 'series_a',
              announced_on: '2023-02-01',
              raised_amount: '$12M',
              lead_investor: 'Seedcamp',
            },
            {
              investment_type: 'series_b',
              announced_on: '2025-06-10',
              raised_amount: '$40M',
              post_money_valuation: '$400M',
            },
          ],
          ratings: [
            {
              source: 'glassdoor',
              rating: 4.3,
              review_count: 212,
              url: 'https://glassdoor.example/globex',
            },
          ],
          products: [{ name: 'Globex Pay', description: '<p>Robot wallets</p>' }],
          acquisitions: [{ acquiree_name: 'Initech' }],
          subsidiary_list: ['Globex EU'],
        }),
      }),
    )
    expect(company).toMatchObject({
      legalName: 'Globex Systems, Inc.',
      tagline: 'Payments for robots.',
      about: 'Globex builds the payment rails that warehouse robots use.',
      atsProvider: 'greenhouse',
      // http:// links are dropped, the rest keep display order.
      links: [
        { kind: 'website', href: 'https://globex.example/' },
        { kind: 'careers', href: 'https://globex.example/careers' },
        { kind: 'linkedin', href: 'https://www.linkedin.com/company/globex' },
        { kind: 'github', href: 'https://github.com/globex' },
      ],
      fundingRounds: [
        { type: 'Series B', date: 'Jun 10, 2025', amount: '$40M', valuation: '$400M' },
        { type: 'Series A', date: 'Feb 1, 2023', amount: '$12M', lead: 'Seedcamp' },
      ],
      ratings: [
        {
          source: 'Glassdoor',
          rating: '4.3',
          reviewCount: 212,
          url: 'https://glassdoor.example/globex',
        },
      ],
      products: [{ name: 'Globex Pay', description: 'Robot wallets' }],
      acquisitions: ['Initech'],
      subsidiaries: ['Globex EU'],
    })
    expect(company!.facts).toEqual([
      { label: 'Ownership', value: 'Public · NASDAQ: GLBX' },
      { label: 'Industry', value: 'Finance' },
    ])
  })
  it('maps 401, 402 and 404 to typed errors', async () => {
    const expectKind = async (status: number, kind: string) => {
      const error = await getJob(
        LIVE,
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
})

describe('sandbox mode', () => {
  const SANDBOX_KEY = 'jbe_test_abcdefghijklmnopqrstu_0123456789'
  const SANDBOX = environmentForKey(SANDBOX_KEY)
  const sandboxDto = (overrides: Record<string, unknown> = {}) =>
    dto({
      source: 'jobosandbox',
      listing_url: 'https://sandbox.jobo.world/apply/cascade-data-engineer',
      apply_url: 'https://sandbox.jobo.world/apply/cascade-data-engineer',
      ...overrides,
    })

  it('searches the same API on the deployment’s sandbox key, across the sandbox ATS only', async () => {
    const calls: Call[] = []
    const fetchImpl = fakeFetch(
      { 'https://connect.example.test/api/jobs/search': json({ jobs: [sandboxDto()], total: 1 }) },
      calls,
    )
    const result = await searchJobs(SANDBOX, parseFilters({ q: 'data' }), fetchImpl)
    // No status lookup: the sandbox's ATS list is fixed.
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      url: 'https://connect.example.test/api/jobs/search',
      method: 'POST',
      key: SANDBOX_KEY,
      body: { queries: ['data'], sources: ['jobosandbox'] },
    })
    expect(result.request.url).toBe('https://connect.example.test/api/jobs/search')
    expect(result.jobs[0]).toMatchObject({
      available: true,
      source: 'jobosandbox',
      sourceName: 'Jobo Sandbox',
      sourceLogoUrl: '/favicon.svg',
      department: 'Jobo Sandbox',
    })
  })
  it('reads sandbox job pages and companies on the sandbox key', async () => {
    const calls: Call[] = []
    const fetchImpl = fakeFetch(
      {
        'https://connect.example.test/api/jobs/': json(sandboxDto()),
        'https://connect.example.test/api/companies/': json({ id: ID, name: 'Cascade' }),
      },
      calls,
    )
    const loaded = await getJobDetail(SANDBOX, ID, fetchImpl)
    expect(loaded.url).toBe(`https://connect.example.test/api/jobs/${ID}`)
    expect(loaded.job.available).toBe(true)
    const OTHER = '7e6d5c4b-3a2f-4e1d-8c0b-9a8f7e6d5c4b'
    expect((await getCompanyProfile(SANDBOX, OTHER, fetchImpl))?.name).toBe('Cascade')
    expect(calls.map((c) => c.key)).toEqual([SANDBOX_KEY, SANDBOX_KEY])
  })
  it('never lists a sandbox job as appliable in production', () => {
    const job = toJob(sandboxDto(), [{ id: 'greenhouse', name: 'Greenhouse' }])
    expect(job.available).toBe(false)
  })
})

describe('environment from the key prefix', () => {
  it.each([
    ['jbe_test_abcdefghijklmnopqrstu', 'sandbox'],
    ['jbe_live_abcdefghijklmnopqrstu', 'production'],
    // Keys from before the jbe_live_/jbe_test_ split are live keys.
    ['jbe_abcdefghijklmnopqrstuvwxyz0', 'production'],
  ])('%s → %s', (key, mode) => {
    expect(keyMode(key)).toBe(mode)
    expect(environmentForKey(key)).toEqual({ mode, apiKey: key })
  })
})

describe('connecting a key', () => {
  it('rejects malformed keys without calling Jobo', async () => {
    const calls: Call[] = []
    expect(await verifyApiKey('sk_live_nope', fakeFetch({}, calls))).toMatchObject({ ok: false })
    expect(calls).toHaveLength(0)
  })
  it('verifies a sandbox key the same way, on the same API', async () => {
    const calls: Call[] = []
    const fetchImpl = fakeFetch(
      {
        'https://connect.example.test/api/jobs/': json({}, 404),
        'https://connect.example.test/api/auto-apply/applications': json({ data: [] }),
      },
      calls,
    )
    const key = 'jbe_test_abcdefghijklmnopqrstu_0123456789'
    expect(await verifyApiKey(key, fetchImpl)).toEqual({ ok: true })
    expect(calls[0].key).toBe(key)
  })
  it('accepts a legacy jbe_ key', async () => {
    const fetchImpl = fakeFetch({
      'https://connect.example.test/api/jobs/': json({}, 404),
      'https://connect.example.test/api/auto-apply/applications': json({ data: [] }),
    })
    expect(await verifyApiKey('jbe_abcdefghijklmnopqrstuvwxyz0123', fetchImpl)).toEqual({
      ok: true,
    })
  })
  it.each([
    'auto_apply_not_enabled',
    'auto_apply_agreement_required',
    'auto_apply_review_required',
  ])('connects a key whose account gets %s: the reason is shown at Apply time', async (code) => {
    const fetchImpl = fakeFetch({
      'https://connect.example.test/api/jobs/': json({}, 404),
      'https://connect.example.test/api/auto-apply/applications': json(
        { code, detail: 'No Auto Apply access.' },
        403,
      ),
    })
    expect(await verifyApiKey(KEY, fetchImpl)).toEqual({ ok: true })
  })
  it('accepts a key Jobo authenticates', async () => {
    const fetchImpl = fakeFetch({
      'https://connect.example.test/api/jobs/': json({}, 404),
      'https://connect.example.test/api/auto-apply/applications': json({ data: [] }),
    })
    expect(await verifyApiKey(KEY, fetchImpl)).toEqual({ ok: true })
  })
  it('accepts a valid key that is out of search credits, but still checks Auto Apply access', async () => {
    const calls: Call[] = []
    const fetchImpl = fakeFetch(
      {
        'https://connect.example.test/api/jobs/': json({}, 402),
        'https://connect.example.test/api/auto-apply/applications': json(
          { code: 'forbidden' },
          403,
        ),
      },
      calls,
    )
    expect(await verifyApiKey(KEY, fetchImpl)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Auto Apply/),
    })
    expect(calls.some((c) => c.url.includes('/api/auto-apply/applications'))).toBe(true)
  })
  it('rejects a key Jobo does not know', async () => {
    const fetchImpl = fakeFetch({ 'https://connect.example.test': json({}, 401) })
    expect(await verifyApiKey(KEY, fetchImpl)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/rejected/),
    })
  })
})
