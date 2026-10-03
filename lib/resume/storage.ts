import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RESUME_DIR } from '@/db/client'

/**
 * Resume PDFs on the local filesystem, under DATA_DIR/resumes.
 *
 * A profile's PDF is `<profileId>.pdf`; every application gets its own frozen
 * copy, `<applicationId>.pdf` (see lib/queue.ts). A real deployment would use
 * object storage (S3, R2, GCS) and hand Jobo a presigned URL directly. The
 * shape is the same either way: store the bytes, serve them over public HTTPS
 * with a short-lived signature. Disk keeps the example free of cloud accounts.
 */

/** Jobo will not download more than 10 MiB; refuse well before that. */
export const MAX_RESUME_BYTES = 5 * 1024 * 1024

function resumePath(id: string): string {
  return join(RESUME_DIR, `${id}.pdf`)
}

export async function saveResume(profileId: string, bytes: Uint8Array): Promise<string> {
  await mkdir(RESUME_DIR, { recursive: true })
  await writeFile(resumePath(profileId), bytes)
  return createHash('sha256').update(bytes).digest('hex')
}

/** A profile's PDF, or an application's frozen copy of it. */
export async function readResume(id: string): Promise<Buffer> {
  return readFile(resumePath(id))
}

/** A PDF response that keeps the original filename, even when it is not ASCII. */
export function pdfResponse(bytes: Buffer, filename: string): Response {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_')
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.byteLength),
      // `inline`, so browsers and ATS previews open the file instead of saving it.
      'Content-Disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  })
}
