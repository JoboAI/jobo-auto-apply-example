import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as schema from '@/db/schema'
import { profiles } from '@/db/schema'
import { SAMPLE_PROFILES, seedSampleProfiles } from '@/db/seed'
import { emptyEeo, resumeProfileSchema } from '@/lib/resume/profile-schema'

/**
 * The sample-profile seed. What matters: it is idempotent (runs on every
 * process start), it never displaces a default the user chose, and the
 * checked-in personas actually satisfy the schema the rest of the app
 * assumes — zod is the source of truth, TypeScript alone misses the
 * described invariants.
 */

function freshDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const database = drizzle(sqlite, { schema })
  migrate(database, { migrationsFolder: join(process.cwd(), 'db/migrations') })
  return database
}

describe('sample personas', () => {
  it.each(SAMPLE_PROFILES)('$id satisfies the profile schema', (sample) => {
    const parsed = resumeProfileSchema.parse(sample.data)
    // The answer engine feeds on these; an empty one would silently degrade
    // every open-ended and work-authorization answer.
    expect(parsed.about.freeform_notes.length).toBeGreaterThan(0)
    expect(parsed.work_authorization.authorized_country_codes.length).toBeGreaterThan(0)
    expect(sample.resumeText.length).toBeGreaterThan(0)
    // Fictional personas must not carry plausible real contact details.
    expect(parsed.personal.email.endsWith('@example.com')).toBe(true)
  })
})

describe('seedSampleProfiles', () => {
  it('is idempotent and copies the resume PDFs', () => {
    const database = freshDb()
    const resumeDir = mkdtempSync(join(tmpdir(), 'jobo-seed-'))

    seedSampleProfiles(database, resumeDir)
    seedSampleProfiles(database, resumeDir)

    const rows = database.select().from(profiles).all()
    expect(rows).toHaveLength(SAMPLE_PROFILES.length)
    expect(rows.filter((row) => row.isDefault)).toHaveLength(1)

    for (const sample of SAMPLE_PROFILES) {
      const row = rows.find((entry) => entry.id === sample.id)
      expect(row).toBeDefined()
      expect(row!.eeo).toEqual(emptyEeo)

      const pdfPath = join(resumeDir, `${sample.id}.pdf`)
      expect(existsSync(pdfPath)).toBe(true)

      const bytes = readFileSync(pdfPath)
      expect(row!.resumeBytes).toBe(bytes.byteLength)
      expect(row!.resumeSha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    }
  })

  it('never displaces an existing default profile', () => {
    const database = freshDb()
    const resumeDir = mkdtempSync(join(tmpdir(), 'jobo-seed-'))

    database
      .insert(profiles)
      .values({
        id: 'user-profile',
        name: 'A Real Person',
        isDefault: true,
        data: SAMPLE_PROFILES[0].data,
        eeo: emptyEeo,
        resumeFilename: 'real.pdf',
        resumeContentType: 'application/pdf',
        resumeBytes: 3,
        resumeSha256: 'abc',
        resumeText: 'real resume'
      })
      .run()

    seedSampleProfiles(database, resumeDir)

    const defaults = database.select().from(profiles).where(eq(profiles.isDefault, true)).all()
    expect(defaults).toHaveLength(1)
    expect(defaults[0].id).toBe('user-profile')
  })
})
