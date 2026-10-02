import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { applications } from '@/db/schema'
import { verifyResumeUrl } from '@/lib/signed-url'
import { readResume } from '@/lib/resume/storage'
export const runtime = 'nodejs'
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const url = new URL(request.url)
  const check = verifyResumeUrl(
    `application:${id}`,
    url.searchParams.get('exp'),
    url.searchParams.get('token'),
  )
  if (!check.ok)
    return new Response('Link expired or invalid', {
      status: check.reason === 'expired' ? 410 : 403,
    })
  const [row] = await db
    .select()
    .from(applications)
    .where(eq(applications.id, id))
    .limit(1)
  if (!row?.userId || !row.profileSnapshot)
    return new Response('Not found', { status: 404 })
  try {
    const bytes = await readResume(id)
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${encodeURIComponent(row.profileSnapshot.resumeFilename)}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
