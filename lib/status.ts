import { isTerminalStatus, type ApplicationStatus } from '@jobo-ai/autoapply'

/**
 * Local rows also carry statuses the API never sends (see the `status` column
 * in db/schema.ts). Of those only `create_failed` is final, so this widens
 * the SDK's terminal check to the strings we actually store.
 */
export function isTerminal(status: string): boolean {
  return status === 'create_failed' || isTerminalStatus(status as ApplicationStatus)
}
