import { afterEach, describe, expect, it } from 'vitest'
import { GET } from '@/app/api/health/route'

/**
 * The probe has to fail when the environment is broken. An orchestrator that
 * sees 200 marks the pod healthy and completes the rollout, while every page
 * and the advance loop 500 on `config()` — a green deploy hiding a dead app.
 */

const REQUIRED = {
  BETTER_AUTH_SECRET: 'b'.repeat(32),
  BETTER_AUTH_URL: 'https://example.com',
  BREVO_API_KEY: 'test-brevo',
  AUTH_EMAIL_FROM: 'noreply@example.com',
  API_KEY_ENCRYPTION_SECRET: 'e'.repeat(32),
  PUBLIC_BASE_URL: 'https://example.com',
  RESUME_URL_SIGNING_SECRET: 'a'.repeat(32),
  OPENROUTER_API_KEY: 'sk-or-v1-test',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://u:p@localhost:5432/db',
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

  it('is 503, naming it, without the secret that seals visitors’ keys', async () => {
    setEnv({ ...REQUIRED, API_KEY_ENCRYPTION_SECRET: undefined })
    const response = GET()
    expect(response.status).toBe(503)
    const body = (await response.json()) as { ok: boolean; missing: string[] }
    expect(body.ok).toBe(false)
    expect(body.missing).toEqual(['API_KEY_ENCRYPTION_SECRET'])
  })

  it('needs no deployment-wide Jobo key, and ignores a leftover JOBO_API_KEY', async () => {
    setEnv({ ...REQUIRED, JOBO_API_KEY: 'jbe_live_leftover_from_an_old_manifest' })
    expect(GET().status).toBe(200)
    setEnv({ JOBO_API_KEY: undefined })
  })

  it('is 503 when a variable is present but malformed', async () => {
    setEnv({ ...REQUIRED, PUBLIC_BASE_URL: 'http://localhost:3000' })
    const response = GET()
    expect(response.status).toBe(503)
  })

  it('requires a public resume origin for the consumer product', async () => {
    setEnv({ ...REQUIRED, PUBLIC_BASE_URL: undefined })
    const response = GET()
    expect(response.status).toBe(503)
  })

  it('never leaks a value, only the variable name', async () => {
    setEnv({ ...REQUIRED, API_KEY_ENCRYPTION_SECRET: 'too-short-but-secret-value' })
    const body = await GET().text()
    expect(body).not.toContain('too-short-but-secret-value')
  })
})
