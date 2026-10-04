import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sandboxJob, sealedKey } from '@/tests/support/jobs'
import { SAMPLE_PROFILES } from '@/tests/support/seed'

/**
 * The worker loop around the engine: caps, draining on shutdown, and what a
 * failed exchange does to the row. The engine itself is mocked here; it has
 * its own tests (engine.test.ts).
 */

const engine = vi.hoisted(() => ({ advance: vi.fn() }))
vi.mock('@/lib/application-engine', () => ({ advanceApplication: engine.advance }))

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'jobo-worker-'))
process.env.API_KEY_ENCRYPTION_SECRET = 'fixture-encryption-secret-with-32-characters'
process.env.OPENROUTER_API_KEY = 'fixture'
process.env.RESUME_URL_SIGNING_SECRET = 'fixture-signing-secret-with-32-characters'

let db: typeof import('@/db/client').db
let schema: typeof import('@/db/schema')
let queue: typeof import('@/lib/queue')
let worker: typeof import('@/lib/worker')

beforeAll(async () => {
  ;({ db } = await import('@/db/client'))
  schema = await import('@/db/schema')
  queue = await import('@/lib/queue')
  worker = await import('@/lib/worker')
  const { seedSampleProfiles } = await import('@/tests/support/seed')
  const { RESUME_DIR } = await import('@/db/client')
  await seedSampleProfiles(db, RESUME_DIR, 'alice')
  const data = structuredClone(SAMPLE_PROFILES[0].data)
  data.links.linkedin = 'https://www.linkedin.com/in/jobo-test-candidate'
  await db
    .update(schema.profiles)
    .set({ reviewedAt: Date.now(), data })
    .where(eq(schema.profiles.id, 'sample-ada-lovelace'))
})

beforeEach(async () => {
  await db.delete(schema.applications)
  engine.advance.mockReset()
})

async function rows() {
  return db.select().from(schema.applications)
}

describe('processApplication', () => {
  it('marks a fresh row as creating, advances it, and releases the lease', async () => {
    const id = await queue.enqueueApplication(
      'alice',
      'sample-ada-lovelace',
      sandboxJob(),
      sealedKey(),
    )
    await queue.claimApplication('w')
    engine.advance.mockImplementation(async () => {
      expect((await rows())[0].status).toBe('creating')
    })
    await worker.processApplication(id, 'w')
    expect(engine.advance).toHaveBeenCalledWith(id, 'w')
    const [row] = await rows()
    expect(row).toMatchObject({ leaseOwner: null, attemptCount: 0, workerError: null })
  })

  it('counts a failed exchange and backs off, with a generic message for the candidate', async () => {
    const id = await queue.enqueueApplication(
      'alice',
      'sample-ada-lovelace',
      sandboxJob(),
      sealedKey(),
    )
    await queue.claimApplication('w')
    engine.advance.mockRejectedValue(new Error('upstream said: secret detail'))
    await worker.processApplication(id, 'w')
    const [row] = await rows()
    expect(row.attemptCount).toBe(1)
    expect(row.nextAttemptAt).toBeGreaterThan(Date.now())
    expect(row.workerError).not.toContain('secret detail')
  })

  it('finishes a canceled, never-started row locally without calling Jobo', async () => {
    const id = await queue.enqueueApplication(
      'alice',
      'sample-ada-lovelace',
      sandboxJob(),
      sealedKey(),
    )
    await db.update(schema.applications).set({ cancelRequested: true })
    await queue.claimApplication('w')
    await worker.processApplication(id, 'w')
    expect(engine.advance).not.toHaveBeenCalled()
    expect((await rows())[0].status).toBe('canceled')
  })
})

describe('runWorker', () => {
  it('runs no more than the global cap at once and drains in-flight work on abort', async () => {
    // Three applications from three candidates, so only the global cap of 2
    // can hold the third back.
    for (const user of ['bob', 'carol'])
      await db
        .insert(schema.user)
        .values({
          id: user,
          name: user,
          email: `${user}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoNothing()
    const owners = ['alice', 'bob', 'carol']
    for (const [i, owner] of owners.entries()) {
      const id = await queue.enqueueApplication(
        'alice',
        'sample-ada-lovelace',
        sandboxJob(i + 1),
        sealedKey(),
      )
      await db
        .update(schema.applications)
        .set({ userId: owner })
        .where(eq(schema.applications.id, id))
    }

    let running = 0
    let peak = 0
    const releases: (() => void)[] = []
    engine.advance.mockImplementation(async () => {
      peak = Math.max(peak, ++running)
      await new Promise<void>((resolve) => releases.push(resolve))
      running--
    })

    const stop = new AbortController()
    const loop = worker.runWorker({
      owner: 'w',
      globalLimit: 2,
      userLimit: 1,
      signal: stop.signal,
      pollMs: 10,
    })
    await vi.waitFor(() => expect(releases).toHaveLength(2))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(peak).toBe(2)

    // Shut down while two are in flight: the loop waits for them.
    stop.abort()
    let finished = false
    void loop.then(() => (finished = true))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(finished).toBe(false)
    releases.forEach((release) => release())
    await loop
    expect(engine.advance).toHaveBeenCalledTimes(2)
    const [health] = await db.select().from(schema.workerHealth)
    expect(health.heartbeatAt).toBeGreaterThan(Date.now() - 5_000)
  })
})
