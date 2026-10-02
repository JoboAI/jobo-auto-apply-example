import { currentUser } from '@/lib/session'
import { readLiveVersion } from '@/lib/live-version'

/** Cheap change detection for the application page's live updates. */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  const user = await currentUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  const live = await readLiveVersion(user.id, id)
  if (!live) return new Response('Not found', { status: 404 })
  return Response.json(live, { headers: { 'cache-control': 'no-store' } })
}
