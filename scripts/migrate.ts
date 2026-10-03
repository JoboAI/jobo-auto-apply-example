/** Apply pending database migrations: `npm run db:migrate` (also run by `npm run dev`). */
import './load-env'
import { runMigrations } from '../db/migrate'

const url = process.env.DATABASE_URL
if (!url) {
  console.error(
    'DATABASE_URL is not set. Copy .env.example to .env.local, then run `npm run db:up`.',
  )
  process.exit(1)
}
try {
  await runMigrations(url)
} catch (error) {
  const host = new URL(url).host
  console.error(
    `Could not migrate the database at ${host}: ${error instanceof Error ? error.message : error}\n` +
      'Is Postgres running? `npm run db:up` starts the local one (Docker).',
  )
  process.exit(1)
}
console.log('Database migrations complete.')
