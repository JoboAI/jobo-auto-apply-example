import { currentUser } from '@/lib/session'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { count } from 'drizzle-orm'
import { db } from '@/db/client'
import { profiles } from '@/db/schema'
import { ResumeExtractionError, extractResumeText } from '@/lib/resume/extract'
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
  const user = await currentUser()
  if (!user)
    return Response.json(
      { error: 'Please sign in to upload your resume.' },
      { status: 401 },
    )
  if (request.headers.get('origin') !== new URL(process.env.BETTER_AUTH_URL!).origin)
    return Response.json({ error: 'Invalid request origin.' }, { status: 403 })
  const owned = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, user.id))
  if (owned.filter((p) => p.createdAt > Date.now() - 3600000).length >= 10)
    return Response.json(
      { error: 'Please wait before uploading more resumes.' },
      { status: 429 },
    )
  if (Number(request.headers.get('content-length')) > MAX_RESUME_BYTES + 65536)
    return Response.json(
      { error: 'The upload limit is 5 MB.' },
      { status: 413 },
    )
  let file: File | null = null
  try {
    const form = await request.formData()
    const candidate = form.get('resume')
    if (candidate instanceof File) file = candidate
  } catch {
    return Response.json(
      { error: 'Expected a multipart form upload.' },
      { status: 400 },
    )
  }

  if (!file) {
    return Response.json({ error: 'No file was uploaded.' }, { status: 400 })
  }
  if (file.size > MAX_RESUME_BYTES) {
    return Response.json(
      {
        error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB.`,
      },
      { status: 413 },
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
      return Response.json(
        { error: error.message, code: error.code },
        { status: 422 },
      )
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
        error:
          'We could not read your resume right now. Please try again shortly.',
      },
      { status: 502 },
    )
  }

  const id = randomUUID()
  const sha256 = await saveResume(id, bytes)
  const [existing] = await db
    .select({ value: count() })
    .from(profiles)
    .where(and(eq(profiles.userId, user.id), eq(profiles.archived, false)))
  const isFirst = (existing?.value ?? 0) === 0

  await db.insert(profiles)
    .values({
      id,
      userId: user.id,
      name: suggestProfileName(profile),
      isDefault: isFirst,
      data: profile,
      resumeFilename: file.name || 'resume.pdf',
      // Jobo matches this against the field's `accepted_file_types`, so record
      // what we will actually serve rather than what the browser claimed.
      resumeContentType: 'application/pdf',
      resumeBytes: bytes.byteLength,
      resumeSha256: sha256,
      resumeText: text,
    })

  log.info({ profileId: id, bytes: bytes.byteLength }, 'imported resume')

  // Straight into the editor: a parsed profile is a draft, not a fact.
  return Response.json({ id, redirectTo: `/profiles/${id}` }, { status: 201 })
}
