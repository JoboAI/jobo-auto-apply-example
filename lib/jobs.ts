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
