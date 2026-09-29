import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
const dir = mkdtempSync(join(tmpdir(), 'jobo-migrate-'))
process.env.DATA_DIR = dir
it('backs up the legacy database and leaves its records unowned', async () => {
  const sqlite = new Database(join(dir, 'app.db'))
  const journal = JSON.parse(
    readFileSync('db/migrations/meta/_journal.json', 'utf8'),
  )
  sqlite.exec(
    'CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  )
  for (const entry of journal.entries.slice(0, 2)) {
    sqlite.exec(
      readFileSync(`db/migrations/${entry.tag}.sql`, 'utf8').replaceAll(
        '--> statement-breakpoint',
        '',
      ),
    )
    sqlite
      .prepare(
        'INSERT INTO __drizzle_migrations (hash,created_at) VALUES (?,?)',
      )
      .run('legacy-test', entry.when)
  }
  sqlite
    .prepare(
      'INSERT INTO profiles (id,name,data,resume_filename,resume_content_type,resume_bytes,resume_sha256,resume_text) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run(
      'legacy',
      'Legacy profile',
      '{}',
      'legacy.pdf',
      'application/pdf',
      1,
      'hash',
      'Legacy text',
    )
  sqlite.close()
  const { db } = await import('@/db/client'),
    { profiles, user } = await import('@/db/schema')
  expect(db.select().from(user).all()).toEqual([])
  const legacy = db.select().from(profiles).all()
  expect(legacy).toHaveLength(1)
  expect(legacy[0]).toMatchObject({
    id: 'legacy',
    name: 'Legacy profile',
    userId: null,
  })
  const backup = readdirSync(dir).find((f) => f.startsWith('before-accounts-'))
  expect(backup).toBeTruthy()
  const old = new Database(join(dir, backup!), { readonly: true })
  expect(
    (
      old.prepare('PRAGMA table_info(profiles)').all() as { name: string }[]
    ).some((c) => c.name === 'user_id'),
  ).toBe(false)
  old.close()
})
