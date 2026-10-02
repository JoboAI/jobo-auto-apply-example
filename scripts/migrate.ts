// CommonJS: a named ESM import of loadEnvConfig fails at runtime.
import nextEnv from '@next/env'
import { runMigrations } from '../db/migrate'

// Reads .env.local locally; in a container, real env vars win.
nextEnv.loadEnvConfig(process.cwd())
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Run `npm run db:up` and copy .env.example to .env.local.')
  process.exit(1)
}
await runMigrations(url)
console.log('Database migrations complete.')
