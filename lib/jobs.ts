import type { Job } from './jobs-types'
import type { JoboMode } from './jobo/environment'

/** Job ids, countries, and the check every application passes when it is queued. */

/** The sandbox's own ATS: every sandbox job has it as its `source`. */
export const SANDBOX_ATS_ID = 'jobosandbox'

/**
 * A two-letter country as ISO 3166 alpha-2, or undefined. Job data often
 * writes the United Kingdom as `UK`, which is not ISO; left as-is it would not
 * match a candidate authorized to work in `GB`.
 */
export function isoCountryCode(value: string | null | undefined): string | undefined {
  const code = value?.trim().toUpperCase()
  if (!code || !/^[A-Z]{2}$/.test(code)) return undefined
  return code === 'UK' ? 'GB' : code
}

/** Jobs and companies are keyed by their Jobo UUID, in both modes. */
export function isJobId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

/**
 * Whether `mode` may apply to `job`: a Jobo job id from the mode's own ATSes,
 * sandbox jobs in sandbox mode and real ones in production. Applications are
 * created by job id, so Jobo resolves where the form is; a sandbox key only
 * ever reaches sandbox forms.
 */
export function validApplyTarget(mode: JoboMode, job: Pick<Job, 'slug' | 'source'>): boolean {
  return isJobId(job.slug) && (job.source === SANDBOX_ATS_ID) === (mode === 'sandbox')
}
