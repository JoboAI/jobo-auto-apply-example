import { configIssues } from '@/lib/config'

/**
 * Liveness/readiness probe. `npm run doctor` calls this THROUGH your tunnel to
 * prove the public internet can reach you before you spend a create quota
 * finding out.
 *
 * It reports 503 when the environment is invalid, which matters the moment
 * this runs anywhere with a scheduler in front of it: every page and the
 * webhook itself need `config()`, so a process with a missing key is not
 * serving anything. Returning a flat 200 would make an orchestrator mark it
 * healthy while every real request 500s — a green rollout hiding a dead app.
 *
 * Names only, never values: this endpoint is public.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(): Response {
  const issues = configIssues()
  if (issues.length > 0) {
    return Response.json(
      {
        ok: false,
        service: 'jobo-auto-apply-nextjs',
        error: 'invalid_configuration',
        missing: issues.map((issue) => issue.key)
      },
      { status: 503 }
    )
  }
  return Response.json({ ok: true, service: 'jobo-auto-apply-nextjs' })
}
