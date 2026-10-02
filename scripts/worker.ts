import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { closeDb, db } from '../db/client'
import { applications, workerHealth } from '../db/schema'
import { advanceApplication } from '../lib/application-engine'
import { claimApplication, renewLease, releaseLease } from '../lib/queue'
import { config } from '../lib/config'

config()
const owner = randomUUID()
const limit = (name: string, fallback: number) =>
  Math.max(
    1,
    Math.min(20, Number.parseInt(process.env[name] ?? '', 10) || fallback),
  )
const globalLimit = limit('WORKER_CONCURRENCY', 2)
const userLimit = limit('WORKER_USER_CONCURRENCY', 1)
const running = new Set<Promise<void>>()
let stopping = false
process.on('SIGTERM', () => {
  stopping = true
})
process.on('SIGINT', () => {
  stopping = true
})

async function run(id: string) {
  const heartbeat = setInterval(() => {
    // A rejected promise in a timer would crash the worker; a missed renewal
    // is recovered by the next one, or by the lease expiring.
    renewLease(id, owner).catch((error) =>
      console.error('Lease renewal failed', { id, error: String(error) }),
    )
  }, 10000)
  let failure: string | undefined
  try {
    const [row] = await db
      .select()
      .from(applications)
      .where(eq(applications.id, id))
      .limit(1)
    if (!row) return
    // Only a never-attempted local queue entry can be canceled without reconciling upstream.
    if (
      row.cancelRequested &&
      !row.joboApplicationId &&
      !row.lastSyncedAt &&
      row.status === 'queued' &&
      row.attemptCount === 0
    ) {
      await db
        .update(applications)
        .set({ status: 'canceled', updatedAt: Date.now() })
        .where(eq(applications.id, id))
    } else {
      if (!row.joboApplicationId)
        await db
          .update(applications)
          .set({ status: 'creating' })
          .where(eq(applications.id, id))
      await advanceApplication(id, owner)
    }
  } catch (error) {
    // Credentials and upstream response bodies must not leak to the product UI.
    console.error('Application worker exchange failed', {
      id,
      type: error instanceof Error ? error.name : 'Error',
    })
    failure =
      'The application service is temporarily unavailable. Retrying safely.'
  } finally {
    clearInterval(heartbeat)
    await releaseLease(id, owner, failure).catch((error) =>
      console.error('Lease release failed', { id, error: String(error) }),
    )
  }
}
while (!stopping) {
  try {
    await db
      .insert(workerHealth)
      .values({ id: 'main', heartbeatAt: Date.now() })
      .onConflictDoUpdate({
        target: workerHealth.id,
        set: { heartbeatAt: Date.now() },
      })
    while (running.size < globalLimit) {
      const job = await claimApplication(owner, globalLimit, userLimit)
      if (!job) break
      const task = run(job.id).finally(() => running.delete(task))
      running.add(task)
    }
  } catch (error) {
    // One database blip must not kill the loop. A lasting outage stops the
    // heartbeat, and the health probe restarts the container.
    console.error('Worker loop iteration failed', { error: String(error) })
  }
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
await Promise.allSettled([...running])
await closeDb()
