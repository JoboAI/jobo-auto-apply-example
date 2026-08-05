import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { profiles } from '@/db/schema'
import { readResume } from '@/lib/resume/storage'
import { verifyResumeUrl } from '@/lib/signed-url'
import { log } from '@/lib/logger'

/**
 * Serves a resume PDF to Jobo.
 *
 * When an application form has a `file` field, the answer is not an upload —
 * it is a URL that Jobo fetches itself, from its own infrastructure, during the
 * callback window. That has consequences worth stating plainly:
 *
 *   - It must be reachable from the public internet over HTTPS on port 443.
 *     `http://localhost:3000` cannot work, and neither can a tunnel that
 *     exposes a non-443 port — Jobo's SSRF guard rejects both before it ever
 *     makes the request.
 *   - It carries no credentials of ours, so the URL authenticates itself via a
 *     short-lived HMAC signature (lib/signed-url.ts).
 *   - The response's Content-Type must match what the field advertises in
 *     `constraints.accepted_file_types`, or the answer is rejected with
 *     `invalid_file_type`. This is the failure mode behind ngrok's free-tier
 *     browser interstitial: it returns text/html and the field looks correct.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ profileId: string }> }
): Promise<Response> {
  const { profileId } = await params
  const url = new URL(request.url)

  const verification = verifyResumeUrl(
    profileId,
    url.searchParams.get('exp'),
    url.searchParams.get('token')
  )
  if (!verification.ok) {
    log.warn({ profileId, reason: verification.reason }, 'rejected resume download')
    return new Response(verification.reason === 'expired' ? 'Link expired' : 'Invalid signature', {
      status: verification.reason === 'expired' ? 410 : 403
    })
  }

  const profile = db.select().from(profiles).where(eq(profiles.id, profileId)).get()
  if (!profile) return new Response('Not found', { status: 404 })

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
      'Cache-Control': 'no-store'
    }
  })
}
