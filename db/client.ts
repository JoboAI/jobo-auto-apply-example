import { Pool } from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { join, resolve } from 'node:path'
import * as schema from './schema'

/**
 * Postgres connection.
 *
 * Two things here are not incidental:
 *
 *  1. **Initialisation is lazy.** `next build` imports every route to collect
 *     its configuration, and the build has no database. Reading DATABASE_URL
 *     on the first query, not at import, keeps the build env-free.
 *
 *  2. **The pool is cached on globalThis.** Next.js hot-reloads server modules
 *     on every edit, and a module-scoped pool would leak connections per
 *     reload until Postgres refuses new ones.
 *
 * Migrations are not run here: `npm run db:migrate` runs them (an init
 * container in production, `npm run dev` locally).
 */

// A runtime directory, not a build input: tell Turbopack not to trace it.
const dataDir = resolve(/* turbopackIgnore: true */ process.env.DATA_DIR ?? './.data')

export type Database = NodePgDatabase<typeof schema>

declare global {
  var __joboDb: { db: Database; pool: Pool } | undefined
}

function create() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Run `npm run db:up` and copy .env.example to .env.local.',
    )
  }
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })
  // An idle client dying (a Postgres restart) emits here. Unhandled, it would
  // crash the process; the pool already discards the client.
  pool.on('error', (error) => console.error('idle postgres client error', error))
  return { pool, db: drizzle(pool, { schema }) }
}

function getDb() {
  return (globalThis.__joboDb ??= create())
}

/**
 * Behaves exactly like a Drizzle instance, but opens the pool on first
 * property access rather than at import. The proxy is the price of keeping the
 * familiar `db.select()...` call sites while staying lazy.
 */
export const db = new Proxy({} as Database, {
  get(_target, property) {
    const instance = getDb().db
    const value = Reflect.get(instance, property, instance)
    return typeof value === 'function' ? value.bind(instance) : value
  },
})

/** Close the pool, so scripts and test files can exit cleanly. */
export async function closeDb() {
  const current = globalThis.__joboDb
  globalThis.__joboDb = undefined
  await current?.pool.end()
}

export { schema }
/** Resume PDFs stay on disk: Jobo downloads them over HTTP for file fields. */
export const RESUME_DIR = join(dataDir, 'resumes')
