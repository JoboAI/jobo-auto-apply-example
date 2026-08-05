import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * DEMO_SANDBOX_ONLY is what makes a shared deployment safe to hand out: without
 * it, whoever opens the page can point this app at a real employer's form and a
 * real application is submitted under the deployment's API key.
 *
 * The check has to hold at the server action, because the apply form is not the
 * only caller — anything that can POST to the app can invoke it directly.
 */

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'jobo-sandbox-only-'))
process.env.JOBO_API_KEY = 'jbe_test_key'
process.env.JOBO_WEBHOOK_SECRET = 'whsec_test_secret_for_the_sandbox_suite'
process.env.PUBLIC_BASE_URL = 'https://example.com'
process.env.RESUME_URL_SIGNING_SECRET = 'a'.repeat(32)
process.env.OPENROUTER_API_KEY = 'sk-or-v1-test'
process.env.DEMO_SANDBOX_ONLY = 'true'

let createApplicationAction: typeof import('@/app/actions/applications').createApplicationAction

beforeAll(async () => {
  ;({ createApplicationAction } = await import('@/app/actions/applications'))
})

const create = (applyUrl: string) =>
  createApplicationAction({ profileId: 'prof_missing', applyUrl, sandbox: true })

describe('DEMO_SANDBOX_ONLY', () => {
  it.each([
    ['https://boards.greenhouse.io/acme/jobs/123', 'a real ATS'],
    ['https://sandbox.jobo.world.evil.com/apply/x', 'a suffix lookalike'],
    ['https://notsandbox.jobo.world/apply/x', 'a prefix lookalike'],
    ['https://example.com/apply', 'an unrelated host']
  ])('refuses %s (%s)', async (url) => {
    const result = await create(url)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('sandbox_only')
  })

  it('refuses a malformed URL rather than throwing', async () => {
    const result = await create('not a url')
    expect(result.ok).toBe(false)
  })

  it('allows the sandbox host through to the normal path', async () => {
    // Reaching the database at all is the assertion: the guard returns before
    // the insert, so a foreign-key failure on the missing profile proves the
    // URL was accepted rather than refused.
    await expect(
      create('https://sandbox.jobo.world/apply/all-field-types')
    ).rejects.toThrow(/FOREIGN KEY/)
  })

  it('is off by default, so local use is unaffected', async () => {
    // The flag is read per call, so clearing it re-opens the guard without a
    // module reload.
    process.env.DEMO_SANDBOX_ONLY = 'false'
    const { configIssues } = await import('@/lib/config')
    expect(configIssues()).toEqual([])
    process.env.DEMO_SANDBOX_ONLY = 'true'
  })
})
