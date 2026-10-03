import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { applications } from '@/db/schema'
import { verifyApplicationResumeUrl } from '@/lib/signed-url'
import { pdfResponse, readResume } from '@/lib/resume/storage'

/**
 * The resume Jobo downloads for an application's `file` field. No session:
 * the request comes from Jobo's servers, so the URL itself is the credential
 * (an expiring HMAC signature, see lib/signed-url.ts).
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const url = new URL(request.url)
  const check = verifyApplicationResumeUrl(
    id,
    url.searchParams.get('exp'),
    url.searchParams.get('token'),
  )
  if (!check.ok)
    return new Response('Link expired or invalid', {
      status: check.reason === 'expired' ? 410 : 403,
    })
  const [row] = await db
    .select({ filename: applications.profileSnapshot })
    .from(applications)
    .where(eq(applications.id, id))
    .limit(1)
  if (!row) return new Response('Not found', { status: 404 })
  try {
    return pdfResponse(await readResume(id), row.filename.resumeFilename)
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
