import { createHash } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RESUME_DIR } from '@/db/client'

/**
 * Resume PDFs on the local filesystem.
 *
 * A real deployment would use object storage (S3, R2, GCS) and hand Jobo a
 * presigned URL directly. The shape is the same either way: store the bytes,
 * serve them over public HTTPS with a short-lived signature. Keeping it on disk
 * here means the example needs no cloud account to run.
 */

/** Jobo will not download more than 10 MiB; refuse well before that. */
export const MAX_RESUME_BYTES = 5 * 1024 * 1024

function resumePath(profileId: string): string {
  return join(RESUME_DIR, `${profileId}.pdf`)
}

export async function saveResume(profileId: string, bytes: Uint8Array): Promise<string> {
  await mkdir(RESUME_DIR, { recursive: true })
  await writeFile(resumePath(profileId), bytes)
  return createHash('sha256').update(bytes).digest('hex')
}

export async function readResume(profileId: string): Promise<Buffer> {
  return readFile(resumePath(profileId))
}

export async function deleteResume(profileId: string): Promise<void> {
  await unlink(resumePath(profileId)).catch(() => {
    // Already gone. Deleting a profile whose file is missing should not fail.
  })
}
