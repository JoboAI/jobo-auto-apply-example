import { beforeEach, describe, expect, it } from 'vitest'
import {
  getProductionJob,
  JobsApiError,
  searchProductionJobs,
  toJob,
  verifyApiKey,
} from '@/lib/jobo/jobs-api'
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

type Call = { url: string; key: string | null }
function fakeFetch(routes: Record<string, () => Response>, calls: Call[] = []) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, key: new Headers(init?.headers).get('x-api-key') })
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
  it('searches only supported ATSes, on the visitor’s key', async () => {
    const calls: Call[] = []
    const fetchImpl = fakeFetch(
      {
        'https://status.example.test': json(status),
        'https://connect.example.test/api/jobs?': json({ jobs: [dto()], total: 40, page: 2, total_pages: 2 }),
      },
      calls,
    )
    await supportedAts(fetchImpl)
    const result = await searchProductionJobs(KEY, { q: ' rust ', location: 'Berlin', page: 2 }, fetchImpl)
    const search = calls.find((c) => c.url.includes('/api/jobs?'))!
    const params = new URL(search.url).searchParams
    expect(params.get('sources')).toBe('greenhouse,lever')
    expect(params.get('q')).toBe('rust')
    expect(params.get('location')).toBe('Berlin')
    expect(params.get('page')).toBe('2')
    expect(params.get('page_size')).toBe('25')
    expect(search.key).toBe(KEY)
    expect(result).toMatchObject({ total: 40, page: 2, totalPages: 2 })
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
