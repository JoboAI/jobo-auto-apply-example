import { eq } from 'drizzle-orm'
import { closeDb, db } from '../db/client'
import { workerHealth } from '../db/schema'

// A probe must answer, even when Postgres does not.
setTimeout(() => process.exit(1), 5000).unref()
const [row] = await db
  .select()
  .from(workerHealth)
  .where(eq(workerHealth.id, 'main'))
  .limit(1)
await closeDb()
process.exit(row && Date.now() - row.heartbeatAt < 30000 ? 0 : 1)
