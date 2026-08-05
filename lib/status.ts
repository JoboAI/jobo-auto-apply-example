import { isTerminalStatus, type ApplicationStatus } from '@jobo-ai/autoapply'

/**
 * Local rows carry two statuses the API never sends: `creating`, written
 * before the create call so that a timeout is recoverable, and `create_failed`
 * when that call never succeeded. Neither is an `ApplicationStatus`, so this
 * widens the SDK's terminal check to the strings we actually store.
 */
export type LocalApplicationStatus = ApplicationStatus | 'creating' | 'create_failed'

export function isTerminal(status: string): boolean {
  return isTerminalStatus(status as ApplicationStatus)
}
