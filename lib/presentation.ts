import type { ApplicationRow } from '@/db/schema'
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
export function applicationLabel(
  row: Pick<ApplicationRow, 'status' | 'stopReason'>,
) {
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
