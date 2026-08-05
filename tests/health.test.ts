import { afterEach, describe, expect, it } from 'vitest'
import { GET } from '@/app/api/health/route'

/**
 * The probe has to fail when the environment is broken. An orchestrator that
 * sees 200 marks the pod healthy and completes the rollout, while every page
 * and the webhook 500 on `config()` — a green deploy hiding a dead app.
 */

const REQUIRED = {
  JOBO_API_KEY: 'jbe_test_key',
  JOBO_WEBHOOK_SECRET: 'whsec_test_secret_for_the_health_suite',
  PUBLIC_BASE_URL: 'https://example.com',
  RESUME_URL_SIGNING_SECRET: 'a'.repeat(32),
  OPENROUTER_API_KEY: 'sk-or-v1-test'
}

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

afterEach(() => setEnv(REQUIRED))

describe('GET /api/health', () => {
  it('is 200 when the environment is valid', async () => {
    setEnv(REQUIRED)
    const response = GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
  })

  it('is 503 when a required variable is missing', async () => {
    setEnv({ ...REQUIRED, JOBO_API_KEY: undefined })
    const response = GET()
    expect(response.status).toBe(503)
    const body = (await response.json()) as { ok: boolean; missing: string[] }
    expect(body.ok).toBe(false)
    expect(body.missing).toContain('JOBO_API_KEY')
  })

  it('is 503 when a variable is present but malformed', async () => {
    setEnv({ ...REQUIRED, JOBO_WEBHOOK_SECRET: 'not-a-whsec-key' })
    const response = GET()
    expect(response.status).toBe(503)
  })

  it('never leaks a value, only the variable name', async () => {
    setEnv({ ...REQUIRED, JOBO_API_KEY: 'jbe_bad_but_secret_value' })
    const body = await GET().text()
    expect(body).not.toContain('jbe_bad_but_secret_value')
  })
})
