/**
 * The background worker process: `npm run worker`.
 *
 * Run exactly one per deployment next to the web app, against the same
 * database, PDF directory (DATA_DIR) and secrets. SIGTERM/SIGINT stop new
 * claims and wait for running applications to reach a checkpoint, so give it
 * a stop grace period of a few minutes. See lib/worker.ts.
 */
import './load-env'
import { randomUUID } from 'node:crypto'
import { closeDb } from '../db/client'
import { config } from '../lib/config'
import { runWorker } from '../lib/worker'

const { WORKER_CONCURRENCY, WORKER_USER_CONCURRENCY } = config()
const stop = new AbortController()
process.on('SIGTERM', () => stop.abort())
process.on('SIGINT', () => stop.abort())

await runWorker({
  owner: randomUUID(),
  globalLimit: WORKER_CONCURRENCY,
  userLimit: WORKER_USER_CONCURRENCY,
  signal: stop.signal,
})
await closeDb()
