import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { count, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import { profiles } from './schema'
import { emptyEeo, type ResumeProfile } from '@/lib/resume/profile-schema'
import * as ada from './seed/ada-lovelace'
import * as grace from './seed/grace-hopper'

/**
 * Two sample profiles, seeded at first database open.
 *
 * They exist so the tutorial's profile dropdown always has something to
 * select — a fresh deployment (or a wiped volume) is runnable in one click,
 * and /profiles stays the place to add real candidates.
 *
 * Idempotency is the same lesson the schema teaches: the ids are FIXED
 * strings, so re-seeding is one `INSERT … ON CONFLICT DO NOTHING` against the
 * primary key — no check-then-act race. Deleting a sample sticks until the
 * next process start, when it reseeds; on the shared public demo that is a
 * feature (the tutorial self-heals), and locally the "Sample —" name explains
 * the reappearance. Applications that cascade-deleted with it stay gone.
 *
 * The persona data is checked in as TypeScript (not parsed from the PDFs at
 * runtime) so seeding needs no OpenRouter key and works in CI. The PDFs are
 * real, tiny, text-extractable files under db/seed/ — inside db/ on purpose,
 * because the Docker runner stage already ships that directory.
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
    resumeText: ada.resumeText
  },
  {
    id: 'sample-grace-hopper',
    name: 'Sample — Grace Hopper',
    pdfFile: 'grace-hopper.pdf',
    data: grace.profile,
    resumeText: grace.resumeText
  }
]

export function seedSampleProfiles(
  database: BetterSQLite3Database<typeof schema>,
  resumeDir: string
): void {
  mkdirSync(resumeDir, { recursive: true })

  // Only claim the default slot when nobody holds it — a user-made default
  // (or a surviving sample) is never displaced by a reseed.
  const hasDefault =
    (database
      .select({ value: count() })
      .from(profiles)
      .where(eq(profiles.isDefault, true))
      .get()?.value ?? 0) > 0

  for (const [index, sample] of SAMPLE_PROFILES.entries()) {
    const source = join(process.cwd(), 'db', 'seed', sample.pdfFile)
    const bytes = readFileSync(source)

    const destination = join(resumeDir, `${sample.id}.pdf`)
    if (!existsSync(destination)) copyFileSync(source, destination)

    database
      .insert(profiles)
      .values({
        id: sample.id,
        name: sample.name,
        isDefault: !hasDefault && index === 0,
        data: sample.data,
        eeo: emptyEeo,
        resumeFilename: sample.pdfFile,
        resumeContentType: 'application/pdf',
        resumeBytes: bytes.byteLength,
        resumeSha256: createHash('sha256').update(bytes).digest('hex'),
        resumeText: sample.resumeText
      })
      .onConflictDoNothing()
      .run()
  }
}
