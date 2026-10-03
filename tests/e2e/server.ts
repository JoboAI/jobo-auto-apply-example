// Isolated test host only. No fixture routes or network overrides ship in the app.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import next from 'next'
import jobs from './jobs.json'
import { profile } from '../../db/seed/ada-lovelace'
import { runMigrations } from '../../db/migrate'
import { createDatabase, databaseUrl, dropDatabase } from '../support/postgres'
Object.assign(process.env, { NODE_ENV: 'test' })
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'jobo-browser-'))
// A throwaway database on the `npm run db:up` server (or TEST_DATABASE_URL).
// Playwright may stop this server before SIGTERM cleanup finishes, so every run
// also drops whatever the previous one left behind.
const database = 'aa_e2e'
await dropDatabase(database)
await createDatabase(database)
process.env.DATABASE_URL = databaseUrl(database)
await runMigrations(process.env.DATABASE_URL)
process.env.BETTER_AUTH_URL = 'http://127.0.0.1:3311'
process.env.BETTER_AUTH_SECRET =
  'browser-fixture-independent-auth-secret-32-characters'
process.env.BREVO_API_KEY = 'fixture-brevo'
process.env.JOBO_API_KEY = 'jbe_test_fixture'
process.env.OPENROUTER_API_KEY = 'fixture-openrouter'
process.env.PUBLIC_BASE_URL = 'https://demo.jobo.world'
process.env.RESUME_URL_SIGNING_SECRET =
  'fixture-resume-signing-secret-32-characters'
process.env.API_KEY_ENCRYPTION_SECRET =
  'fixture-api-key-encryption-secret-32-characters'
// Production mode: the only visitor key the stubbed Jobo API accepts.
const VISITOR_KEY = 'jbe_live_e2eVisitorFixture0000_000000000000000000000000000000000000000'
const productionJobs = [
  {
    id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    title: 'Platform Engineer',
    company: {
      id: '0b8c3f4e-6d1a-4c2b-9e7f-5a4d3c2b1a09',
      name: 'Globex Systems',
      logo_url: null,
      website: 'globex.example',
      industries: ['Software'],
      categories: ['b2b', 'saas'],
    },
    external_id: 'GLX-PLAT-118',
    summary: 'Run the platform that runs everything else.',
    description:
      '<p>Kubernetes, Postgres and on-call you can live with.</p>' +
      '<p><strong>How we work</strong></p><ul><li>Small teams</li><li>Written decisions</li></ul>',
    listing_url: 'https://jobs.lever.co/globex/7c9e6679',
    apply_url: 'https://jobs.lever.co/globex/7c9e6679/apply',
    locations: [
      { location: 'Toronto, ON, Canada', city: 'Toronto', region: 'ON', country: 'CA' },
      { location: 'Montreal, QC, Canada', city: 'Montreal', region: 'QC', country: 'CA' },
    ],
    date_posted: '2026-09-28T09:00:00Z',
    valid_through: '2026-10-30T00:00:00Z',
    qualifications: {
      must_have: { skills: [{ name: 'Kubernetes', type: 'hard' }], education: [], certifications: [] },
      preferred: { skills: [{ name: 'Terraform', type: 'hard' }], education: [], certifications: ['CKA'] },
    },
    benefits: ['Four-day on-call rotation', 'Home office budget'],
    is_work_auth_required: true,
    is_h1b_sponsor: false,
    is_clearance_required: false,
    employment_type: 'full_time',
    workplace_type: 'Hybrid',
    experience_level: 'Senior',
    compensation: { min: 150000, max: 190000, currency: 'CAD', period: 'yearly' },
    source: 'lever',
    responsibilities: ['Own the deploy pipeline', 'Keep Postgres fast'],
  },
  {
    id: '16fd2706-8baf-433b-82eb-8c7fada847da',
    title: 'Product Designer',
    company: {
      id: '5e1d2c3b-4a59-4687-8f9e-0d1c2b3a4f5e',
      name: 'Initech',
      logo_url: null,
      website: 'initech.example',
      industries: ['Design'],
      categories: ['b2c'],
    },
    summary: 'Design the tools people use every day.',
    description: null,
    listing_url: 'https://job-boards.greenhouse.io/initech/jobs/42',
    apply_url: 'https://job-boards.greenhouse.io/initech/jobs/42',
    locations: [{ location: 'Remote — Europe', country: null }],
    employment_type: 'full_time',
    workplace_type: 'Remote',
    experience_level: 'Mid Level',
    source: 'greenhouse',
    responsibilities: [],
  },
]
// The full profiles behind GET /api/companies/{id}.
const companyProfiles: Record<string, Record<string, unknown>> = {
  '0b8c3f4e-6d1a-4c2b-9e7f-5a4d3c2b1a09': {
    id: '0b8c3f4e-6d1a-4c2b-9e7f-5a4d3c2b1a09',
    name: 'Globex Systems',
    website: 'globex.example',
    company_size: '201-500',
    founding_year: '2014',
    headquarters_location: 'Toronto, Canada',
    funding_stage: 'series_b',
    funds_total_formatted: '$64M',
    investors: ['Northwind Capital', 'Example Ventures'],
    ats_provider: 'lever',
    linkedin_url: 'https://www.linkedin.com/company/globex-example',
    github_url: 'https://github.com/globex-example',
    leadership: [{ name: 'Hank Scorpio', title: 'Chief Executive Officer', linkedin_url: 'https://www.linkedin.com/in/hank-example' }],
    funding_rounds: [{ investment_type: 'series_b', announced_on: '2025-03-04', raised_amount: '$40M', lead_investor: 'Northwind Capital' }],
    ratings: [{ source: 'glassdoor', rating: '4.4', review_count: 87 }],
    tech_stack: [{ name: 'Kubernetes' }, { name: 'Postgres' }],
    industries: ['Software'],
    categories: ['b2b', 'saas'],
  },
}
/** A canonical facet key from a display value ("Mid Level" → "mid"). */
const facetKey = (value: string) => value.toLowerCase().replace(/ level$/, '').replace(/-/g, '')
/** What the stub search can filter on, and the facet counts it returns. */
function stubSearch(body: Record<string, any>) {
  const lower = (values?: string[]) => (values ?? []).map((v) => v.toLowerCase())
  const q = (body.queries?.[0] ?? '').toLowerCase()
  const matches = productionJobs.filter((j) => {
    const industries = lower(j.company.industries)
    const companyRefs = [j.company.id, j.company.name.toLowerCase(), j.company.website]
    return (
      (body.sources ?? []).includes(j.source) &&
      `${j.title} ${j.company.name}`.toLowerCase().includes(q) &&
      (!body.industries?.include || lower(body.industries.include).some((i) => industries.includes(i))) &&
      !lower(body.industries?.exclude).some((i) => industries.includes(i)) &&
      (!body.company_categories?.include || lower(body.company_categories.include).some((c) => j.company.categories.includes(c))) &&
      (!body.companies?.include || lower(body.companies.include).some((c) => companyRefs.includes(c))) &&
      (!body.work_models || body.work_models.includes(facetKey(j.workplace_type))) &&
      (!body.experience_levels || body.experience_levels.includes(facetKey(j.experience_level)))
    )
  })
  const count = (keys: string[]) =>
    Object.entries(keys.reduce<Record<string, number>>((all, k) => ({ ...all, [k]: (all[k] ?? 0) + 1 }), {}))
      .map(([key, n]) => ({ key, count: n }))
  return {
    jobs: matches,
    total: matches.length,
    page: 1,
    page_size: 25,
    total_pages: 1,
    facets: {
      work_model: count(matches.map((j) => facetKey(j.workplace_type))),
      experience_level: count(matches.map((j) => facetKey(j.experience_level))),
      employment_type: count(matches.map(() => 'full-time')),
      sources: count(matches.map((j) => j.source)),
      industries: count(matches.flatMap((j) => j.company.industries)),
      company_categories: count(matches.flatMap((j) => j.company.categories)),
      countries: count(matches.flatMap((j) => (j.locations[0].country === 'CA' ? ['canada'] : []))),
    },
    ...(body.companies?.include
      ? {
          filters: {
            companies: {
              matched: body.companies.include.flatMap((query: string) => {
                const hit = productionJobs.find((j) => [j.company.id, j.company.website].includes(query.toLowerCase()))
                return hit ? [{ query, companies: [{ id: hit.company.id, name: hit.company.name }] }] : []
              }),
            },
          },
        }
      : {}),
  }
}
const originalFetch = globalThis.fetch
const emails: string[] = []
const upstream = new Map<string, Record<string, unknown>>()
let workerEnabled = true
globalThis.fetch = async (input, options) => {
  const url = new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url,
  )
  const body = options?.body ? JSON.parse(String(options.body)) : {}
  if (url.hostname === 'api.brevo.com') {
    emails.push(body.textContent)
    return Response.json({ messageId: 'fixture' })
  }
  if (url.hostname === 'sandbox.jobo.world' && url.pathname === '/api/jobs')
    return Response.json({
      available: true,
      jobs: jobs.map(j => ({ ...j, available: true, apply_url: `https://sandbox.jobo.world/apply/${j.slug}` })),
    })
  if (url.hostname === 'openrouter.ai')
    return Response.json({
      model: 'deepseek/deepseek-v4-flash-0731',
      choices: [{ message: { content: JSON.stringify(profile) } }],
    })
  if (url.hostname === 'enterprise.jobo.world' && url.pathname === '/api/v1/public/status/uptime')
    return Response.json({
      auto_apply_providers: [
        { provider_id: 'greenhouse', display_name: 'Greenhouse' },
        { provider_id: 'jobosandbox', display_name: 'Sandbox' },
        { provider_id: 'lever', display_name: 'Lever' },
      ],
    })
  if (url.hostname === 'connect.jobo.world' && url.pathname.startsWith('/api/jobs')) {
    if (new Headers(options?.headers).get('X-Api-Key') !== VISITOR_KEY)
      return Response.json({ error: 'Invalid or expired API key' }, { status: 401 })
    if (url.pathname === '/api/jobs/search' && options?.method === 'POST')
      return Response.json(stubSearch(body))
    const job = productionJobs.find((j) => url.pathname === `/api/jobs/${j.id}`)
    return job ? Response.json(job) : Response.json({ error: 'Not found' }, { status: 404 })
  }
  if (url.hostname === 'connect.jobo.world' && url.pathname.startsWith('/api/companies/')) {
    const profile = companyProfiles[url.pathname.split('/')[3]]
    return profile ? Response.json(profile) : Response.json({ error: 'Not found' }, { status: 404 })
  }
  if (
    url.hostname === 'connect.jobo.world' &&
    url.pathname === '/api/auto-apply/applications' &&
    (options?.method ?? 'GET').toUpperCase() === 'GET'
  )
    return Response.json({ data: [], has_more: false, next_cursor: null })
  if (url.hostname === 'connect.jobo.world') {
    if (url.pathname.endsWith('/sandbox/scenarios'))
      return Response.json({
        available: true,
        scenarios: ['all-field-types', 'multi-step'].map((slug) => ({
          slug,
          apply_url: `https://sandbox.jobo.world/apply/${slug}`,
        })),
      })
    const id = url.pathname.split('/')[4]
    if (url.pathname === '/api/auto-apply/applications') {
      const key =
        new Headers(options?.headers).get('Idempotency-Key') ?? 'fixture-id'
      if (!upstream.has(key))
        upstream.set(key, {
          api_version: '2026-08-31',
          id: key,
          provider_id: 'sandbox',
          provider_name: 'Jobo Sandbox',
          status: 'awaiting_answers',
          failure: null,
          current_step: {
            id: `step-${key}`,
            sequence: 1,
            correction_round: 0,
            command_errors: [],
            fields: [
              {
                field_id: 'full_name',
                type: 'text',
                label: 'Full name',
                required: true,
                requires_answer: true,
              },
            ],
            answers_expire_at: new Date(Date.now() + 300000).toISOString(),
          },
        })
      await new Promise((r) => setTimeout(r, 600))
      return Response.json(upstream.get(key))
    }
    const item = upstream.get(id)
    if (!item) return Response.json({ code: 'not_found' }, { status: 404 })
    if (url.pathname.endsWith('/answers')) {
      await new Promise((r) => setTimeout(r, 1500))
      item.status = 'submitted'
      item.current_step = null
    }
    if (url.pathname.endsWith('/cancel')) {
      item.status = 'canceled'
      item.current_step = null
    }
    return Response.json(item)
  }
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    return originalFetch(input, options)
  throw new Error(
    `Test blocked an unexpected network request to ${url.hostname}`,
  )
}
const app = next({ dev: false, hostname: '127.0.0.1', port: 3311 })
await app.prepare()
const handler = app.getRequestHandler()
const server = createServer((req, res) => {
  if (req.url === '/__test__/mail') {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(emails))
    return
  }
  if (req.url?.startsWith('/__test__/worker/')) {
    workerEnabled = req.url.endsWith('/on')
    res.end('ok')
    return
  }
  void handler(req, res)
})
await new Promise<void>((resolve) => server.listen(3311, '127.0.0.1', resolve))
const { claimApplication, renewLease, releaseLease } =
  await import('../../lib/queue')
const { advanceApplication } = await import('../../lib/application-engine')
let running = false
const timer = setInterval(async () => {
  if (!workerEnabled || running) return
  running = true
  const row = await claimApplication('browser-fixture-worker').catch((e) => {
    console.error('Fixture claim failed', e)
    return null
  })
  if (!row) {
    running = false
    return
  }
  try {
    await renewLease(row.id, 'browser-fixture-worker')
    await advanceApplication(row.id, 'browser-fixture-worker')
    await releaseLease(row.id, 'browser-fixture-worker')
  } catch (e) {
    console.error('Fixture worker failed', e)
    await releaseLease(row.id, 'browser-fixture-worker', 'Fixture exchange failed')
  } finally {
    running = false
  }
}, 500)
process.on('SIGTERM', async () => {
  clearInterval(timer)
  server.close()
  await globalThis.__joboDb?.pool.end()
  await dropDatabase(database).catch(() => {})
  process.exit(0)
})
console.log('Isolated browser test server ready')
