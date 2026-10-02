import { randomBytes } from 'node:crypto'
import { afterAll, inject } from 'vitest'
import { createDatabase, databaseUrl, dropDatabase } from './postgres'

/**
 * Setup file: every test file runs against its own fresh, migrated database,
 * named under the run's template so global teardown can sweep leftovers.
 */
const template = inject('pgTemplate')
const name = `${template.replace('aa_tpl_', 'aa_t_')}_${randomBytes(4).toString('hex')}`
await createDatabase(name, template)
process.env.DATABASE_URL = databaseUrl(name)

afterAll(async () => {
  await globalThis.__joboDb?.pool.end()
  globalThis.__joboDb = undefined
  await dropDatabase(name)
})
