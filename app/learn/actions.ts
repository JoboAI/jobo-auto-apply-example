'use server'

import { configIssues } from '@/lib/config'
import { runPreflight, type CheckResult } from '@/lib/doctor-checks'

/**
 * The tutorial's in-browser preflight — the same checks as `npm run doctor`,
 * shared via lib/doctor-checks.ts.
 */
export async function runPreflightAction(): Promise<CheckResult[]> {
  const issues = configIssues()
  if (issues.length > 0) {
    return issues.map((issue) => ({
      status: 'fail' as const,
      name: `env ${issue.key}`,
      detail: issue.message
    }))
  }
  return runPreflight()
}
