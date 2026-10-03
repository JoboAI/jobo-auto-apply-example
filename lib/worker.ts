import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { applications, workerHealth } from '@/db/schema'
import { advanceApplication } from '@/lib/application-engine'
import { log } from '@/lib/logger'
import {
  claimApplication,
  LeaseLostError,
  releaseLease,
  renewLease,
  updateLeased,
} from '@/lib/queue'

/**
 * The background worker: claim → advance → release, forever.
 *
 * Run it as its own process next to the web app (`npm run worker`). It is the
 * only thing that calls the Auto Apply API for an application; the browser
 * just reads the rows it writes. Several workers can share one database: the
 * claim in lib/queue.ts enforces the concurrency caps across all of them.
 */

/** Lease renewal interval. Must be well under LEASE_MS (lib/queue.ts). */
const HEARTBEAT_MS = 10_000
/** How often an idle worker looks for new work. */
const POLL_MS = 1_000

/** Shown in the UI while a failed attempt waits to be retried. */
const RETRY_MESSAGE = 'The application service is temporarily unavailable. Retrying safely.'

/** Claim one application, advance it by one exchange, release it. */
export async function processApplication(id: string, owner: string): Promise<void> {
  const heartbeat = setInterval(() => {
    // A rejected promise in a timer would crash the worker; a missed renewal
    // is recovered by the next one, or by the lease expiring.
    renewLease(id, owner).catch((error) => log.error({ id, error }, 'lease renewal failed'))
  }, HEARTBEAT_MS)
  let failure: string | undefined
  try {
    const [row] = await db.select().from(applications).where(eq(applications.id, id)).limit(1)
    if (!row) return
    // Canceled before any attempt: nothing exists upstream, so finish locally.
    if (
      row.cancelRequested &&
      !row.joboApplicationId &&
      !row.lastSyncedAt &&
      row.status === 'queued' &&
      row.attemptCount === 0
    ) {
      await updateLeased(id, owner, {
        status: 'canceled',
        apiKeyCiphertext: null,
        updatedAt: Date.now(),
      })
      return
    }
    if (!row.joboApplicationId) await updateLeased(id, owner, { status: 'creating' })
    await advanceApplication(id, owner)
  } catch (error) {
    if (error instanceof LeaseLostError) {
      // Another worker owns the row now; it carries on from the stored state.
      log.warn({ id }, 'lease lost mid-run')
      return
    }
    // The full error goes to the server log. The candidate sees a generic
    // retry message: upstream errors can include details not meant for them.
    log.error({ id, error }, 'application exchange failed')
    failure = RETRY_MESSAGE
  } finally {
    clearInterval(heartbeat)
    await releaseLease(id, owner, failure).catch((error) =>
      log.error({ id, error }, 'lease release failed'),
    )
  }
}

export interface WorkerOptions {
  /** Unique per process; recorded as the lease owner. */
  owner: string
  globalLimit: number
  userLimit: number
  /** Resolves the loop when aborted; running applications finish first. */
  signal: AbortSignal
  pollMs?: number
}

/**
 * The worker loop. Records a heartbeat (read by `npm run worker:health`),
 * fills free slots with claims, and on abort waits for in-flight
 * applications to reach their next checkpoint before returning.
 */
export async function runWorker(options: WorkerOptions): Promise<void> {
  const { owner, globalLimit, userLimit, signal, pollMs = POLL_MS } = options
  const running = new Set<Promise<void>>()
  log.info({ owner, globalLimit, userLimit }, 'worker started')
  while (!signal.aborted) {
    try {
      await db
        .insert(workerHealth)
        .values({ id: 'main', heartbeatAt: Date.now() })
        .onConflictDoUpdate({ target: workerHealth.id, set: { heartbeatAt: Date.now() } })
      while (running.size < globalLimit && !signal.aborted) {
        const claimed = await claimApplication(owner, globalLimit, userLimit)
        if (!claimed) break
        const task = processApplication(claimed.id, owner).finally(() => running.delete(task))
        running.add(task)
      }
    } catch (error) {
      // One database blip must not kill the loop. A lasting outage stops the
      // heartbeat, and the health probe restarts the process.
      log.error({ error }, 'worker loop iteration failed')
    }
    await sleep(pollMs, signal)
  }
  log.info({ owner, inFlight: running.size }, 'worker stopping')
  await Promise.allSettled([...running])
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}
