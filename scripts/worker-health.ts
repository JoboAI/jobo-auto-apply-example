import { db } from '../db/client'
import { workerHealth } from '../db/schema'
const row = db.select().from(workerHealth).get()
process.exit(row && Date.now() - row.heartbeatAt < 30000 ? 0 : 1)
