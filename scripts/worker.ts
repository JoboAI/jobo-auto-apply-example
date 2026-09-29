import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
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
  const heartbeat = setInterval(() => renewLease(id, owner), 10000)
  let failure: string | undefined
  try {
    const row = db
      .select()
      .from(applications)
      .where(eq(applications.id, id))
      .get()!
    // Only a never-attempted local queue entry can be canceled without reconciling upstream.
    if (
      row.cancelRequested &&
      !row.joboApplicationId &&
      !row.lastSyncedAt &&
      row.status === 'queued' &&
      row.attemptCount === 0
    ) {
      db.update(applications)
        .set({ status: 'canceled', updatedAt: Date.now() })
        .where(eq(applications.id, id))
        .run()
    } else {
      if (!row.joboApplicationId)
        db.update(applications)
          .set({ status: 'creating' })
          .where(eq(applications.id, id))
          .run()
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
    releaseLease(id, owner, failure)
  }
}
while (!stopping) {
  db.insert(workerHealth)
    .values({ id: 'main', heartbeatAt: Date.now() })
    .onConflictDoUpdate({
      target: workerHealth.id,
      set: { heartbeatAt: Date.now() },
    })
    .run()
  while (running.size < globalLimit) {
    const job = claimApplication(owner, globalLimit, userLimit)
    if (!job) break
    const task = run(job.id).finally(() => running.delete(task))
    running.add(task)
  }
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
await Promise.allSettled([...running])
