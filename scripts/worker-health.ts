/**
 * Worker liveness probe: `npm run worker:health`. Exits 0 when the worker
 * recorded a heartbeat in the last 30 seconds, 1 otherwise (including when
 * Postgres does not answer within 5 seconds).
 */
import './load-env'
import { eq } from 'drizzle-orm'
import { closeDb, db } from '../db/client'
import { workerHealth } from '../db/schema'

const MAX_AGE_MS = 30_000

setTimeout(() => process.exit(1), 5_000).unref()
const [row] = await db.select().from(workerHealth).where(eq(workerHealth.id, 'main')).limit(1)
await closeDb()
process.exit(row && Date.now() - row.heartbeatAt < MAX_AGE_MS ? 0 : 1)
