import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { apiExchanges, applications, steps } from '@/db/schema'
import { isTerminal } from './status'

/**
 * A fingerprint of everything the application page shows that the worker can
 * change: status, cancel flag, step progress and recorded API exchanges.
 *
 * The page renders it, and `/api/applications/[id]/live` computes it from the
 * same rows, so the browser can tell cheaply whether a refresh is needed — and
 * whether a refresh actually landed (see components/ApplicationLive.tsx).
 */
export function liveVersion(
  row: { status: string; cancelRequested: boolean; updatedAt: number },
  history: { status: string; submittedAt: number | null }[],
  exchanges: { finishedAt: number | null }[],
): string {
  return [
    row.status,
    row.cancelRequested ? 1 : 0,
    row.updatedAt,
    history.map((step) => `${step.status}${step.submittedAt ? '+' : ''}`).join(','),
    exchanges.length,
    exchanges.filter((exchange) => exchange.finishedAt !== null).length,
  ].join(':')
}

/** The live fingerprint for one of the user's applications, or null. */
export async function readLiveVersion(userId: string, id: string) {
  const [row] = await db
    .select({
      status: applications.status,
      cancelRequested: applications.cancelRequested,
      updatedAt: applications.updatedAt,
    })
    .from(applications)
    .where(and(eq(applications.id, id), eq(applications.userId, userId)))
    .limit(1)
  if (!row) return null
  const history = await db
    .select({ status: steps.status, submittedAt: steps.submittedAt })
    .from(steps)
    .where(eq(steps.applicationId, id))
    .orderBy(asc(steps.receivedAt))
  // Same cap and order as the page, so both sides count the same rows.
  const exchanges = await db
    .select({ finishedAt: apiExchanges.finishedAt })
    .from(apiExchanges)
    .where(eq(apiExchanges.applicationId, id))
    .orderBy(asc(apiExchanges.startedAt))
    .limit(100)
  return {
    version: liveVersion(row, history, exchanges),
    active: !isTerminal(row.status),
  }
}
