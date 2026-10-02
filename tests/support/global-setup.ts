import type { TestProject } from 'vitest/node'
import { runMigrations } from '../../db/migrate'
import { admin, createDatabase, databaseUrl, dropDatabase } from './postgres'

declare module 'vitest' {
  export interface ProvidedContext {
    pgTemplate: string
  }
}

/**
 * Migrate ONE template database per run. Every test file then gets its own
 * copy (tests/support/database.ts), which is a file-level copy and far faster
 * than migrating again — and it keeps vitest's parallel files isolated.
 */
export default async function setup(project: TestProject) {
  const template = `aa_tpl_${process.pid}`
  await createDatabase(template)
  await runMigrations(databaseUrl(template))
  project.provide('pgTemplate', template)
  return async () => {
    await admin(async (client) => {
      const { rows } = await client.query<{ datname: string }>(
        `select datname from pg_database where datname like $1`,
        [`aa_t_${process.pid}_%`],
      )
      for (const { datname } of rows)
        await client.query(`drop database if exists "${datname}" with (force)`)
    })
    await dropDatabase(template)
  }
}
