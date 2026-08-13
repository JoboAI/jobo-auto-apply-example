import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import * as schema from './schema'
import { seedSampleProfiles } from './seed'

/**
 * SQLite connection.
 *
 * Two things here are not incidental:
 *
 *  1. **Initialisation is lazy.** Opening the database at module import time
 *     breaks `next build`: the build spawns several worker processes which each
 *     import every route to collect its configuration, and they then race each
 *     other running `migrate()` — producing `SQLITE_BUSY: database is locked`
 *     and a failed build. Deferring the connection to the first actual query
 *     means importing a route costs nothing, and only real requests open it.
 *
 *  2. **The instance is cached on globalThis.** Next.js hot-reloads server
 *     modules on every edit, and a module-scoped connection would leak a file
 *     handle per reload until SQLite refuses to open another.
 */

const dataDir = resolve(process.env.DATA_DIR ?? './.data')
const dbPath = join(dataDir, 'app.db')

type DrizzleDatabase = ReturnType<typeof create>

declare global {
  // eslint-disable-next-line no-var
  var __joboDb: DrizzleDatabase | undefined
}

function create() {
  mkdirSync(dirname(dbPath), { recursive: true })
  const sqlite = new Database(dbPath)

  // WAL lets the UI read while the advance loop is mid-write. Without it,
  // loading a page during answer generation blocks on the writer.
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.pragma('foreign_keys = ON')

  const database = drizzle(sqlite, { schema })

  // Migrate on first use, so `npm run dev` works with no separate setup step.
  // Retry on a lock: several server processes may reach this simultaneously,
  // and whichever loses the race just needs to wait for the winner to finish.
  for (let attempt = 0; ; attempt++) {
    try {
      migrate(database, { migrationsFolder: join(process.cwd(), 'db/migrations') })
      break
    } catch (error) {
      const busy = error instanceof Error && /SQLITE_BUSY|database is locked/i.test(error.message)
      if (!busy || attempt >= 10) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    }
  }

  // Seed the sample profiles right behind the migration, at the one choke
  // point every process passes through. Idempotent (fixed ids + ON CONFLICT
  // DO NOTHING) and env-free. A failure degrades to an empty dropdown rather
  // than a database that refuses to open.
  try {
    seedSampleProfiles(database, RESUME_DIR)
  } catch (error) {
    console.warn('sample profile seeding failed:', error)
  }

  return database
}

function getDb(): DrizzleDatabase {
  if (globalThis.__joboDb) return globalThis.__joboDb
  const created = create()
  globalThis.__joboDb = created
  return created
}

/**
 * Behaves exactly like a Drizzle instance, but opens the connection on first
 * property access rather than at import. The proxy is the price of keeping the
 * familiar `db.select()...` call sites while staying lazy.
 */
export const db = new Proxy({} as DrizzleDatabase, {
  get(_target, property, receiver) {
    const instance = getDb()
    const value = Reflect.get(instance, property, receiver)
    return typeof value === 'function' ? value.bind(instance) : value
  }
})

export { schema }
export const RESUME_DIR = join(dataDir, 'resumes')
