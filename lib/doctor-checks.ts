import { config } from './config'

/**
 * Preflight checks for `npm run doctor`. Each corresponds to a real failure
 * that is painful to diagnose mid-application: a key that cannot list
 * applications, or a model that cannot answer, both surface 30 seconds into a
 * run otherwise. There is nothing network-topological to check any more — the
 * loop is plain HTTPS calls from this app to Jobo, so no tunnel, no public
 * reachability, no clock skew.
 */

export interface CheckResult {
  status: 'pass' | 'fail' | 'warn' | 'info'
  name: string
  detail: string
}

async function checkOpenRouter(): Promise<CheckResult> {
  const c = config()
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: c.OPENROUTER_ANSWER_MODEL,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        max_tokens: 5
      }),
      signal: AbortSignal.timeout(30_000)
    })
    if (response.ok) return { status: 'pass', name: 'OpenRouter', detail: `${c.OPENROUTER_ANSWER_MODEL} responded` }
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
    return { status: 'fail', name: 'OpenRouter', detail: `${response.status} ${body.error?.message ?? ''}`.trim() }
  } catch (error) {
    return { status: 'fail', name: 'OpenRouter', detail: error instanceof Error ? error.message : String(error) }
  }
}

async function checkJoboKey(): Promise<CheckResult> {
  const c = config()
  try {
    const response = await fetch(`${c.JOBO_API_BASE_URL}/api/auto-apply/applications?limit=1`, {
      headers: { 'X-Api-Key': c.JOBO_API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store'
    })
    if (response.ok) return { status: 'pass', name: 'Jobo API key', detail: 'list applications succeeded' }
    const body = (await response.json().catch(() => ({}))) as { code?: string; detail?: string }
    return { status: 'fail', name: 'Jobo API key', detail: `${response.status} ${body.code ?? ''} ${body.detail ?? ''}`.trim() }
  } catch (error) {
    return { status: 'fail', name: 'Jobo API key', detail: error instanceof Error ? error.message : String(error) }
  }
}

async function checkSandbox(): Promise<CheckResult> {
  try {
    const response = await fetch(`${config().JOBO_API_BASE_URL}/api/auto-apply/sandbox/scenarios`, {
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store'
    })
    const body = (await response.json()) as { available?: boolean }
    if (body.available) return { status: 'pass', name: 'Sandbox', detail: 'scenarios are available' }
    return {
      status: 'info',
      name: 'Sandbox',
      detail:
        'not available — application creation is gated off on this deployment (503 auto_apply_coming_soon). Reads and cancels still work.'
    }
  } catch {
    return { status: 'warn', name: 'Sandbox', detail: 'could not read the scenario catalogue' }
  }
}

/** Resume serving is optional; say plainly what its absence means. */
function checkResumeServing(): CheckResult {
  if (config().PUBLIC_BASE_URL) {
    return {
      status: 'pass',
      name: 'Resume files',
      detail: `file fields will be answered with signed URLs on ${config().PUBLIC_BASE_URL}`
    }
  }
  return {
    status: 'info',
    name: 'Resume files',
    detail:
      'PUBLIC_BASE_URL is not set — file fields are skipped (an application that requires a resume will cancel cleanly). Everything else works.'
  }
}

/** Run every check concurrently. Assumes configIssues() is empty. */
export async function runPreflight(): Promise<CheckResult[]> {
  return Promise.all([
    checkJoboKey(),
    checkOpenRouter(),
    checkSandbox(),
    Promise.resolve(checkResumeServing())
  ])
}
