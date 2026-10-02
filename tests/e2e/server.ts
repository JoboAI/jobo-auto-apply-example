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
