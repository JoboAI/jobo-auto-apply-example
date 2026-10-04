import type { ApplicationRow } from '@/db/schema'

/**
 * How application state is shown to the candidate: labels, whether a retry
 * is allowed, and readable reasons for refusals. Shared by server pages and
 * client components, so it imports types only.
 */

export interface CardApplication {
  id: string
  status: string
  label: string
  active: boolean
  retryable: boolean
  cancelRequested: boolean
  answeredSteps: number
  message: string | null
  /** Set when Jobo refused to start it because the key's account lacks access. */
  access: AccessProblem | null
}

/** Where a visitor creates keys, and where an account's Auto Apply access is handled. */
export const API_KEYS_URL = 'https://enterprise.jobo.world/api-keys'
export const AUTO_APPLY_ACCESS_URL = 'https://enterprise.jobo.world/auto-apply'

/**
 * The create refusals that mean "this key's account cannot use Auto Apply
 * yet" (403): no access, the agreement not accepted, or the business review
 * not approved. Sandbox keys do not need any of these, so in practice they
 * come from production keys.
 */
const ACCESS_CODES = [
  'auto_apply_not_enabled',
  'auto_apply_agreement_required',
  'auto_apply_review_required',
] as const

export function isAccessCode(code: string | null | undefined): boolean {
  return (ACCESS_CODES as readonly (string | null | undefined)[]).includes(code)
}

export interface AccessProblem {
  /** The key the application ran on was a sandbox key. */
  sandbox: boolean
  /** The API's own explanation (problem `detail`). */
  detail: string
}

/** The API's detail, ready to follow a colon: no trailing period, never empty. */
export function accessReason(detail: string | null | undefined): string {
  return detail?.trim().replace(/\.+$/, '') || 'Auto Apply is not enabled for its account'
}

/** The access problem behind a create refusal, if that is what it was. */
export function accessProblem(
  row: Pick<ApplicationRow, 'status' | 'createErrorCode' | 'createErrorDetail' | 'sandbox'>,
): AccessProblem | null {
  if (row.status !== 'create_failed' || !isAccessCode(row.createErrorCode)) return null
  return { sandbox: row.sandbox, detail: row.createErrorDetail ?? '' }
}
export function applicationLabel(row: Pick<ApplicationRow, 'status' | 'stopReason'>) {
  if (row.status === 'submitted') return 'Submitted'
  if (
    row.status === 'canceled' &&
    (!row.stopReason || row.stopReason === 'Canceled at your request.')
  )
    return 'Canceled'
  if (
    row.status === 'failed' ||
    row.status === 'create_failed' ||
    row.status === 'recovery_required' ||
    (row.status === 'canceled' && row.stopReason)
  )
    return 'Couldn’t complete'
  if (row.status === 'queued' || row.status === 'creating') return 'Queued'
  return 'Applying'
}
/**
 * A retry starts a brand-new application, so it is offered only when the last
 * one definitely did not submit. `submission_unconfirmed` means it may have.
 */
export function canRetry(row: Pick<ApplicationRow, 'status' | 'failureCode'>) {
  return (
    ['failed', 'create_failed', 'canceled'].includes(row.status) &&
    row.failureCode !== 'submission_unconfirmed'
  )
}
export function displayDate(time: number) {
  return (
    new Intl.DateTimeFormat('en', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(time) + ' UTC'
  )
}

/**
 * What to tell the visitor when Jobo refuses to create an application. The
 * account checks (access, credits, concurrency) are the key's own account's.
 * Access refusals are also shown with their actions (components/AccessProblemNotice.tsx).
 */
export function createFailureMessage(
  code: string | undefined,
  { sandbox, detail }: { sandbox: boolean; detail?: string },
): string {
  if (isAccessCode(code)) {
    const why = accessReason(detail)
    return sandbox
      ? `Jobo refused this sandbox application: ${why}.`
      : `Your production key’s account can’t use Auto Apply yet: ${why}. Switch to a sandbox key to try the full flow.`
  }
  switch (code) {
    case 'unsupported_ats':
      return 'Auto Apply does not support this job’s application form yet.'
    case 'ambiguous_ats':
      return 'Auto Apply could not tell which application system this job uses.'
    case 'concurrency_limit_reached':
      return 'Your Jobo account already has the maximum number of applications running. Retry when one finishes.'
    case 'application_quota_exceeded':
    case 'application_capacity_exceeded':
      return 'Your Jobo account has reached its Auto Apply limit for now. Please retry later.'
    case 'job_not_found':
      return 'Jobo could not find this job any more — it may have closed.'
    default:
      return 'The application service could not start this application. Please try again later.'
  }
}
