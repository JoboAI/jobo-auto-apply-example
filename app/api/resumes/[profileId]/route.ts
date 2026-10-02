import { currentUser } from '@/lib/session'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { profiles } from '@/db/schema'
import { readResume } from '@/lib/resume/storage'

/** Private profile PDF downloads. The worker uses application-specific signed snapshots. */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ profileId: string }> },
): Promise<Response> {
  const { profileId } = await params

  const user = await currentUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1)
  if (!profile || profile.userId !== user.id || profile.archived)
    return new Response('Not found', { status: 404 })

  let bytes: Buffer
  try {
    bytes = await readResume(profileId)
  } catch {
    return new Response('Resume file missing', { status: 404 })
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': profile.resumeContentType,
      'Content-Length': String(bytes.byteLength),
      // `inline` rather than `attachment`: Jobo is a machine, and some ATSes
      // preview the file in a browser context.
      'Content-Disposition': `inline; filename="${encodeURIComponent(profile.resumeFilename)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
