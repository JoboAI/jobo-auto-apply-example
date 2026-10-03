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
 * What to tell the visitor when Jobo refuses to create an application. These
 * codes mostly matter in production mode, where the visitor's own account
 * (its Auto Apply access, credits, concurrency) is what Jobo checks.
 */
export function createFailureMessage(code: string | undefined): string {
  switch (code) {
    case 'auto_apply_not_enabled':
      return 'Auto Apply is not enabled for this API key’s Jobo account. Request access in the Jobo dashboard, then retry.'
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
