import { createClient, type JoboAutoApply } from '@jobo-ai/autoapply'
import { recordingFetch } from './recording-fetch'
import { config } from '@/lib/config'
import type { SandboxScenariosResponse } from './sandbox'

/**
 * The Auto Apply API client.
 *
 * This is `@jobo-ai/autoapply`, the same package we publish for customers —
 * the example does not hand-roll a client, because you should not have to
 * either. It covers the whole customer-facing surface:
 *
 *   applications.create / get / list / cancel / submitAnswers / run
 *
 * That is deliberately all there is. There is no profile API, no resume
 * upload, no webhook and no "fetch pending questions" endpoint. The loop is
 * synchronous: `create` BLOCKS until the first step's fields are discovered
 * and hands them back in `current_step`; `submitAnswers` validates for free,
 * then BLOCKS while Jobo fills the form and resolves to the next step, a
 * correction round, or the terminal application. `get(id, { waitSeconds })`
 * re-attaches after a dropped connection. See app/actions/applications.ts.
 */

let cached: { client: JoboAutoApply; fingerprint: string } | null = null

/**
 * `apiKey` overrides the deployment's key — production mode passes the
 * visitor's own key, so the application belongs to their Jobo account.
 */
export function jobo(applicationId?: string, apiKey?: string): JoboAutoApply {
  const c = config()
  const key = apiKey ?? c.JOBO_API_KEY
  if (applicationId) {
    const secrets = [key, c.JOBO_API_KEY, c.OPENROUTER_API_KEY, c.RESUME_URL_SIGNING_SECRET,
      c.API_KEY_ENCRYPTION_SECRET, process.env.BETTER_AUTH_SECRET, process.env.BREVO_API_KEY]
      .filter((v): v is string => !!v)
    return createClient({ apiKey: key, baseUrl: c.JOBO_API_BASE_URL,
      fetch: recordingFetch(applicationId, secrets) })
  }
  if (apiKey) return createClient({ apiKey, baseUrl: c.JOBO_API_BASE_URL })
  // Re-create when the env changes under us (dev server, tests) rather than
  // pinning the first key we ever saw.
  const fingerprint = `${c.JOBO_API_BASE_URL}\u0000${c.JOBO_API_KEY}`
  if (!cached || cached.fingerprint !== fingerprint) {
    cached = {
      fingerprint,
      client: createClient({
        apiKey: c.JOBO_API_KEY,
        baseUrl: c.JOBO_API_BASE_URL,
        // The SDK retries network errors, 429, 502 and 503 on its own, and
        // replays create with the same Idempotency-Key, so a retry cannot
        // produce a second application.
      }),
    }
  }
  return cached.client
}

/** Public sandbox form availability; account grants are checked on create. */
export async function getSandboxScenarios(
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<SandboxScenariosResponse> {
  const response = await fetch('https://sandbox.jobo.world/api/jobs', {
    headers: { Accept: 'application/json' },
    signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 10_000),
    cache: 'no-store'
  })
  if (!response.ok) throw new Error(`Sandbox scenarios unavailable (HTTP ${response.status})`)
  const catalog = await response.json() as { available: boolean; jobs: { slug: string; role: string; about: string; apply_url: string | null }[] }
  return {
    available: catalog.available,
    scenarios: catalog.jobs.map(j => ({ slug: j.slug, name: j.role, description: j.about, apply_url: j.apply_url })),
  }
}
