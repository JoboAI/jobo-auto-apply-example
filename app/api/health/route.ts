/**
 * Liveness probe. `npm run doctor` calls this THROUGH your tunnel to prove the
 * public internet can reach you before you spend a create quota finding out.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(): Response {
  return Response.json({ ok: true, service: 'jobo-auto-apply-nextjs' })
}
