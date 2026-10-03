import { Client } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { join } from 'node:path'

/** Any fixed key: only migrators take it. */
const MIGRATION_LOCK = 727_001

/**
 * Apply db/migrations. Safe to run concurrently (a dev server and a test run,
 * or two pods): the drizzle migrator does not lock, so an advisory lock
 * serialises the runs and the loser finds nothing left to do.
 */
export async function runMigrations(url: string) {
  const client = await connectWithRetry(url)
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK])
    await migrate(drizzle(client), {
      migrationsFolder: join(process.cwd(), 'db/migrations'),
    })
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {})
    await client.end()
  }
}

/** Postgres may still be starting (a fresh container, a deploy that starts both at once). */
async function connectWithRetry(url: string, attempts = 30): Promise<Client> {
  for (let attempt = 1; ; attempt++) {
    // A pg Client cannot be reused after a failed connect.
    const client = new Client({ connectionString: url })
    try {
      await client.connect()
      return client
    } catch (error) {
      if (attempt >= attempts) throw error
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
}
