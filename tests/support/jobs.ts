import { seal } from '@/lib/secret-box'
import type { Job } from '@/lib/jobs-types'

/**
 * A sandbox job as lib/jobo/job-format.ts maps it from the API sandbox:
 * a Jobo job id, the `jobosandbox` source and a sandbox.jobo.world form.
 * `n` gives each job its own id and form, for tests that queue several.
 */
export function sandboxJob(n = 1, overrides: Partial<Job> = {}): Job {
  return {
    slug: `5a4d0b0c-0000-4000-8000-${String(n).padStart(12, '0')}`,
    company: 'Cascade',
    mark: 'CA',
    role: 'Data engineer',
    location: 'Leeds, UK',
    department: 'Jobo Sandbox',
    employmentType: 'Full-time',
    about: 'Data pipelines',
    responsibilities: ['Build data products'],
    applyUrl: `https://sandbox.jobo.world/apply/cascade-data-engineer-${n}`,
    available: true,
    source: 'jobosandbox',
    sourceName: 'Jobo Sandbox',
    countryCode: 'GB',
    ...overrides,
  }
}

/** A sandbox key and a production key, shaped like real ones. */
export const SANDBOX_KEY = 'jbe_test_sandboxfixture00000000_0123456789abcdefghijklmnop'
export const LIVE_KEY = 'jbe_live_abcdefghijklmnopqrstu_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG'

/**
 * A visitor's key as enqueueApplication takes it: sealed with the test
 * file's API_KEY_ENCRYPTION_SECRET, with the mode its prefix gives.
 */
export function sealedKey(apiKey: string = SANDBOX_KEY) {
  return {
    mode: apiKey.startsWith('jbe_test_') ? ('sandbox' as const) : ('production' as const),
    apiKeyCiphertext: seal(apiKey, process.env.API_KEY_ENCRYPTION_SECRET!),
  }
}
