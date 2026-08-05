import { randomUUID } from 'node:crypto'
import { count } from 'drizzle-orm'
import { db } from '@/db/client'
import { profiles } from '@/db/schema'
import { ResumeExtractionError, extractResumeText } from '@/lib/resume/extract'
import { emptyEeo } from '@/lib/resume/profile-schema'
import { MAX_RESUME_BYTES, saveResume } from '@/lib/resume/storage'
import { structureResume, suggestProfileName } from '@/lib/resume/structure'
import { log } from '@/lib/logger'

/**
 * Resume upload.
 *
 * A route handler rather than a Server Action, deliberately: Server Actions cap
 * request bodies at 1 MB by default (`serverActions.bodySizeLimit`), and plenty
 * of design-heavy PDFs exceed that. The failure mode is an opaque generic
 * error, which is a miserable thing to debug. Every other mutation in this app
 * IS a Server Action — this one endpoint is the exception, and it is the
 * exception for a reason.
 */

export const runtime = 'nodejs'
/** Extraction plus one structuring call. Generous, since it runs once. */
export const maxDuration = 120

export async function POST(request: Request): Promise<Response> {
  let file: File | null = null
  try {
    const form = await request.formData()
    const candidate = form.get('resume')
    if (candidate instanceof File) file = candidate
  } catch {
    return Response.json({ error: 'Expected a multipart form upload.' }, { status: 400 })
  }

  if (!file) {
    return Response.json({ error: 'No file was uploaded.' }, { status: 400 })
  }
  if (file.size > MAX_RESUME_BYTES) {
    return Response.json(
      { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB.` },
      { status: 413 }
    )
  }

  const bytes = new Uint8Array(await file.arrayBuffer())

  let text: string
  try {
    text = await extractResumeText(bytes)
  } catch (error) {
    if (error instanceof ResumeExtractionError) {
      // 422 rather than 400: the request was well-formed, the content was not
      // usable. The message is deliberately actionable — see extract.ts.
      return Response.json({ error: error.message, code: error.code }, { status: 422 })
    }
    throw error
  }

  let profile
  try {
    profile = await structureResume(text)
  } catch (error) {
    log.error({ err: error }, 'resume structuring failed')
    return Response.json(
      {
        error: `Could not structure that resume: ${
          error instanceof Error ? error.message : String(error)
        }`
      },
      { status: 502 }
    )
  }

  const id = randomUUID()
  const sha256 = await saveResume(id, bytes)
  const isFirst = (db.select({ value: count() }).from(profiles).get()?.value ?? 0) === 0

  db.insert(profiles)
    .values({
      id,
      name: suggestProfileName(profile),
      isDefault: isFirst,
      data: profile,
      eeo: emptyEeo,
      resumeFilename: file.name || 'resume.pdf',
      // Jobo matches this against the field's `accepted_file_types`, so record
      // what we will actually serve rather than what the browser claimed.
      resumeContentType: 'application/pdf',
      resumeBytes: bytes.byteLength,
      resumeSha256: sha256,
      resumeText: text
    })
    .run()

  log.info({ profileId: id, bytes: bytes.byteLength }, 'imported resume')

  // Straight into the editor: a parsed profile is a draft, not a fact.
  return Response.json({ id, redirectTo: `/profiles/${id}` }, { status: 201 })
}
