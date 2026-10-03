import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { count, eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { profiles, user } from '@/db/schema'
import type { ResumeProfile } from '@/lib/resume/profile-schema'
import * as ada from '../fixtures/ada-lovelace'
import * as grace from '../fixtures/grace-hopper'

/**
 * Test fixtures: two fictional reviewed profiles with real PDFs. The app
 * itself never seeds data; every profile comes from a candidate's upload.
 */

export interface SampleProfile {
  id: string
  name: string
  pdfFile: string
  data: ResumeProfile
  resumeText: string
}

export const SAMPLE_PROFILES: SampleProfile[] = [
  {
    id: 'sample-ada-lovelace',
    name: 'Sample — Ada Lovelace',
    pdfFile: 'ada-lovelace.pdf',
    data: ada.profile,
    resumeText: ada.resumeText,
  },
  {
    id: 'sample-grace-hopper',
    name: 'Sample — Grace Hopper',
    pdfFile: 'grace-hopper.pdf',
    data: grace.profile,
    resumeText: grace.resumeText,
  },
]

/**
 * Insert both samples, owned by `ownerId` (created if missing), and copy their
 * PDFs into `resumeDir`. Idempotent; tests reassign owners afterwards.
 */
export async function seedSampleProfiles(
  database: Database,
  resumeDir: string,
  ownerId = 'sample-owner',
): Promise<void> {
  mkdirSync(resumeDir, { recursive: true })
  await database
    .insert(user)
    .values({
      id: ownerId,
      name: ownerId,
      email: `${ownerId}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing()

  // Only claim the default slot when nobody holds it — a user-made default
  // (or a surviving sample) is never displaced by a reseed.
  const [defaults] = await database
    .select({ value: count() })
    .from(profiles)
    .where(eq(profiles.isDefault, true))
  const hasDefault = (defaults?.value ?? 0) > 0

  for (const [index, sample] of SAMPLE_PROFILES.entries()) {
    const source = join(process.cwd(), 'tests', 'fixtures', sample.pdfFile)
    const bytes = readFileSync(source)

    const destination = join(resumeDir, `${sample.id}.pdf`)
    if (!existsSync(destination)) copyFileSync(source, destination)

    await database
      .insert(profiles)
      .values({
        id: sample.id,
        userId: ownerId,
        name: sample.name,
        isDefault: !hasDefault && index === 0,
        data: sample.data,
        resumeFilename: sample.pdfFile,
        resumeContentType: 'application/pdf',
        resumeBytes: bytes.byteLength,
        resumeSha256: createHash('sha256').update(bytes).digest('hex'),
        resumeText: sample.resumeText,
      })
      .onConflictDoNothing()
  }
}
