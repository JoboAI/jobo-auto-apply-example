import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db as database } from '@/db/client'
import { profiles, user } from '@/db/schema'
import { SAMPLE_PROFILES, seedSampleProfiles } from '@/tests/support/seed'
import { resumeProfileSchema } from '@/lib/resume/profile-schema'
import { employmentIssues } from '@/lib/resume/completeness'

/**
 * The sample-profile test fixtures. What matters: seeding is idempotent, it
 * never displaces a default the user chose, and the
 * checked-in personas actually satisfy the schema the rest of the app
 * assumes — zod is the source of truth, TypeScript alone misses the
 * described invariants.
 */

// This file's own database (tests/support/database.ts), emptied per test.
beforeEach(async () => {
  await database.delete(profiles)
})

describe('sample personas', () => {
  it.each(SAMPLE_PROFILES)('$id satisfies the profile schema', (sample) => {
    const parsed = resumeProfileSchema.parse(sample.data)
    // The answer engine feeds on these; an empty one would silently degrade
    // every open-ended and work-authorization answer.
    expect(parsed.experience.length).toBeGreaterThan(0)
    expect(employmentIssues(parsed)).toEqual(
      Object.fromEntries(Object.keys(employmentIssues(parsed)).map((key) => [key, ''])),
    )
    expect(sample.resumeText.length).toBeGreaterThan(0)
    // Fictional personas must not carry plausible real contact details.
    expect(parsed.personal.email.endsWith('@example.com')).toBe(true)
  })
})

describe('seedSampleProfiles', () => {
  it('is idempotent and copies the resume PDFs', async () => {
    const resumeDir = mkdtempSync(join(tmpdir(), 'jobo-seed-'))

    await seedSampleProfiles(database, resumeDir)
    await seedSampleProfiles(database, resumeDir)

    const rows = await database.select().from(profiles)
    expect(rows).toHaveLength(SAMPLE_PROFILES.length)
    expect(rows.filter((row) => row.isDefault)).toHaveLength(1)

    for (const sample of SAMPLE_PROFILES) {
      const row = rows.find((entry) => entry.id === sample.id)
      expect(row).toBeDefined()
      expect(row!.data).toEqual(sample.data)

      const pdfPath = join(resumeDir, `${sample.id}.pdf`)
      expect(existsSync(pdfPath)).toBe(true)

      const bytes = readFileSync(pdfPath)
      expect(row!.resumeBytes).toBe(bytes.byteLength)
      expect(row!.resumeSha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    }
  })

  it('never displaces an existing default profile', async () => {
    const resumeDir = mkdtempSync(join(tmpdir(), 'jobo-seed-'))

    await database
      .insert(user)
      .values({
        id: 'sample-owner',
        name: 'Owner',
        email: 'sample-owner@example.com',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
    await database.insert(profiles).values({
      id: 'user-profile',
      userId: 'sample-owner',
      name: 'A Real Person',
      isDefault: true,
      data: SAMPLE_PROFILES[0].data,
      resumeFilename: 'real.pdf',
      resumeContentType: 'application/pdf',
      resumeBytes: 3,
      resumeSha256: 'abc',
      resumeText: 'real resume',
    })

    await seedSampleProfiles(database, resumeDir)

    const defaults = await database.select().from(profiles).where(eq(profiles.isDefault, true))
    expect(defaults).toHaveLength(1)
    expect(defaults[0].id).toBe('user-profile')
  })
})
