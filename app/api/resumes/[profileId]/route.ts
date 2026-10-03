import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { profiles } from '@/db/schema'
import { pdfResponse, readResume } from '@/lib/resume/storage'
import { currentUser } from '@/lib/session'

/**
 * A candidate's own profile PDF, for the "view resume" link. Owner only.
 * Jobo never uses this route: it downloads each application's frozen copy
 * through the signed app/api/application-resumes/[id] route.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ profileId: string }> },
): Promise<Response> {
  const { profileId } = await params
  const user = await currentUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  const [profile] = await db
    .select()
    .from(profiles)
    .where(
      and(eq(profiles.id, profileId), eq(profiles.userId, user.id), eq(profiles.archived, false)),
    )
    .limit(1)
  if (!profile) return new Response('Not found', { status: 404 })
  try {
    return pdfResponse(await readResume(profileId), profile.resumeFilename)
  } catch {
    return new Response('Resume file missing', { status: 404 })
  }
}
