import { z } from 'zod'
import type { Job } from './jobs-types'
const metadata = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]*$/),
  company: z.string(),
  mark: z.string(),
  role: z.string(),
  location: z.string(),
  department: z.string(),
  employmentType: z.string(),
  about: z.string(),
  responsibilities: z.array(z.string()),
  available: z.boolean(),
  apply_url: z.string().nullable(),
})
// The sandbox feed lists fictional postings only. This guard keeps its test
// scenarios (login walls, unconfirmable submits, …) out of the demo even if an
// older sandbox that still served them is live.
const excluded = new Set([
  'validation-errors',
  'login-wall',
  'cancel-mid-run',
  'submission-unconfirmed',
  'email-verification',
])
/**
 * The ISO 3166 alpha-2 country of a posting, from its trailing location token
 * ("Leeds, UK", "Austin, TX, US"). The catalog writes the United Kingdom as
 * `UK`, which is not ISO: read raw, a GB-authorized candidate was answered
 * "not authorized". A location with no country ("Remote — Europe") is
 * undefined, so work-authorization questions are never guessed.
 */
export function jobCountryCode(location: string): string | undefined {
  const code = location.trim().match(/,\s*([A-Z]{2})$/)?.[1]
  if (!code) return undefined
  return code === 'UK' ? 'GB' : code
}

export function validSandboxUrl(value: string, slug: string): boolean {
  try {
    const u = new URL(value)
    return (
      u.protocol === 'https:' &&
      u.hostname === 'sandbox.jobo.world' &&
      !u.port &&
      !u.username &&
      !u.password &&
      u.pathname === `/apply/${slug}` &&
      !u.search &&
      !u.hash
    )
  } catch {
    return false
  }
}
/**
 * A production job's destination: a Jobo job id plus an https apply URL. Jobo
 * resolves the ATS from the job id itself; the URL is kept for display and
 * as the audit record of where the application went.
 */
export function validProductionTarget(jobId: string, applyUrl: string): boolean {
  if (!isProductionJobId(jobId)) return false
  try {
    const u = new URL(applyUrl)
    return u.protocol === 'https:' && !u.username && !u.password
  } catch {
    return false
  }
}

/**
 * Production jobs are keyed by their Jobo UUID, sandbox jobs by a readable
 * slug (`multi-step`). Routing, saving and applying all branch on this; a
 * sandbox row is still pinned to sandbox.jobo.world by validSandboxUrl.
 */
export function isProductionJobId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

export async function getJobs(): Promise<Job[]> {
  const response = await fetch('https://sandbox.jobo.world/api/jobs', {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok)
    throw new Error(
      'Jobs are temporarily unavailable. Please try again shortly.',
    )
  const { jobs, available } = z
    .object({ available: z.boolean(), jobs: z.array(metadata) })
    .parse(await response.json())
  return jobs
    .filter((j) => !excluded.has(j.slug))
    .map((j) => {
      const url = j.apply_url ?? ''
      return {
        ...j,
        applyUrl: url,
        available: available && j.available && validSandboxUrl(url, j.slug),
      }
    })
}
