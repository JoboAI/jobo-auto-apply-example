import { authConfigIssues, configIssues } from '@/lib/config'

/**
 * Liveness/readiness probe.
 *
 * It reports 503 when the environment is invalid, which matters the moment
 * this runs anywhere with a scheduler in front of it: every page and the
 * advance loop need `config()`, so a process with a missing key is not
 * serving anything. Returning a flat 200 would make an orchestrator mark it
 * healthy while every real request 500s — a green rollout hiding a dead app.
 *
 * Names only, never values: this endpoint is public.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(): Response {
  const issues = [...configIssues(), ...authConfigIssues()]
  // Optional for local development, but a deployment without it cannot
  // answer resume upload fields, which nearly every application has.
  if (!process.env.PUBLIC_BASE_URL) issues.push({ key: 'PUBLIC_BASE_URL', message: 'required' })
  if (issues.length > 0) {
    return Response.json(
      {
        ok: false,
        service: 'jobo-auto-apply-example',
        error: 'invalid_configuration',
        missing: issues.map((issue) => issue.key),
      },
      { status: 503 },
    )
  }
  return Response.json({ ok: true, service: 'jobo-auto-apply-example' })
}
