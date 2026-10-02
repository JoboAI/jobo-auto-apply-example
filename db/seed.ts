import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { count, eq } from 'drizzle-orm'
import type { Database } from './client'
import { profiles } from './schema'
import type { ResumeProfile } from '@/lib/resume/profile-schema'
import * as ada from './seed/ada-lovelace'
import * as grace from './seed/grace-hopper'

/** Explicit test fixtures only. Production database initialization never seeds profiles. */

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

export async function seedSampleProfiles(
  database: Database,
  resumeDir: string,
): Promise<void> {
  mkdirSync(resumeDir, { recursive: true })

  // Only claim the default slot when nobody holds it — a user-made default
  // (or a surviving sample) is never displaced by a reseed.
  const [defaults] = await database
    .select({ value: count() })
    .from(profiles)
    .where(eq(profiles.isDefault, true))
  const hasDefault = (defaults?.value ?? 0) > 0

  for (const [index, sample] of SAMPLE_PROFILES.entries()) {
    const source = join(process.cwd(), 'db', 'seed', sample.pdfFile)
    const bytes = readFileSync(source)

    const destination = join(resumeDir, `${sample.id}.pdf`)
    if (!existsSync(destination)) copyFileSync(source, destination)

    await database
      .insert(profiles)
      .values({
        id: sample.id,
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
