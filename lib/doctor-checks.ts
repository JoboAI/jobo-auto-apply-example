import { JoboAPIError } from '@jobo-ai/autoapply'
import { sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { authConfig, config } from './config'
import { jobo } from './jobo/client'
import { SANDBOX_JOBS_URL } from './jobs'

/**
 * Preflight checks for `npm run doctor`. Each one catches a mistake that is
 * otherwise painful to find: a Jobo key without Auto Apply access or a model
 * that cannot answer both surface 30 seconds into a run, an unverified Brevo
 * sender only when the first signup never gets its email.
 */

export interface CheckResult {
  status: 'pass' | 'fail' | 'warn' | 'info'
  name: string
  detail: string
}

function failure(name: string, error: unknown): CheckResult {
  return { status: 'fail', name, detail: error instanceof Error ? error.message : String(error) }
}

async function checkDatabase(): Promise<CheckResult> {
  try {
    const result = await db.execute(
      sql`select count(*)::int as applied from drizzle.__drizzle_migrations`,
    )
    const applied = Number(result.rows[0]?.applied ?? 0)
    return {
      status: 'pass',
      name: 'Postgres',
      detail: `connected, ${applied} migration(s) applied`,
    }
  } catch (error) {
    return failure('Postgres', error)
  }
}

async function checkJoboKey(): Promise<CheckResult> {
  try {
    await jobo().applications.list({ limit: 1 })
    return { status: 'pass', name: 'Jobo API key', detail: 'listing applications succeeded' }
  } catch (error) {
    if (error instanceof JoboAPIError)
      return {
        status: 'fail',
        name: 'Jobo API key',
        detail: `${error.status} ${error.code}: ${error.message}`,
      }
    return failure('Jobo API key', error)
  }
}

async function checkOpenRouter(): Promise<CheckResult> {
  const c = config()
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: c.OPENROUTER_ANSWER_MODEL,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (response.ok)
      return {
        status: 'pass',
        name: 'OpenRouter',
        detail: `${c.OPENROUTER_ANSWER_MODEL} responded`,
      }
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
    return {
      status: 'fail',
      name: 'OpenRouter',
      detail: `${response.status} ${body.error?.message ?? ''}`.trim(),
    }
  } catch (error) {
    return failure('OpenRouter', error)
  }
}

/**
 * The key works and Brevo will accept AUTH_EMAIL_FROM: either it is one of the
 * account's active senders, or its domain is authenticated in Brevo (then any
 * address on that domain can send).
 */
async function checkBrevo(): Promise<CheckResult> {
  const { BREVO_API_KEY, AUTH_EMAIL_FROM } = authConfig()
  const get = (path: string) =>
    fetch(`https://api.brevo.com/v3${path}`, {
      headers: { 'api-key': BREVO_API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
  try {
    const [sendersResponse, domainsResponse] = await Promise.all([
      get('/senders'),
      get('/senders/domains'),
    ])
    if (!sendersResponse.ok)
      return { status: 'fail', name: 'Brevo', detail: `${sendersResponse.status} listing senders` }
    const { senders = [] } = (await sendersResponse.json()) as {
      senders?: { email: string; active: boolean }[]
    }
    const { domains = [] } = domainsResponse.ok
      ? ((await domainsResponse.json()) as {
          domains?: { domain_name: string; authenticated: boolean }[]
        })
      : {}
    const from = AUTH_EMAIL_FROM.toLowerCase()
    if (senders.some((s) => s.active && s.email.toLowerCase() === from))
      return { status: 'pass', name: 'Brevo', detail: `${AUTH_EMAIL_FROM} is an active sender` }
    const domain = from.split('@')[1]
    if (domains.some((d) => d.authenticated && d.domain_name.toLowerCase() === domain))
      return {
        status: 'pass',
        name: 'Brevo',
        detail: `${domain} is an authenticated sending domain`,
      }
    return {
      status: 'fail',
      name: 'Brevo',
      detail: `${AUTH_EMAIL_FROM} is neither an active sender nor on an authenticated domain in this Brevo account, so account emails will not send`,
    }
  } catch (error) {
    return failure('Brevo', error)
  }
}

async function checkSandbox(): Promise<CheckResult> {
  try {
    const response = await fetch(SANDBOX_JOBS_URL, { signal: AbortSignal.timeout(10_000) })
    const body = (await response.json()) as { available?: boolean }
    if (body.available)
      return { status: 'pass', name: 'Sandbox', detail: 'fictional jobs are available' }
    return {
      status: 'warn',
      name: 'Sandbox',
      detail: 'the sandbox reports its forms as unavailable right now; try again later',
    }
  } catch {
    return { status: 'warn', name: 'Sandbox', detail: 'could not read the sandbox job list' }
  }
}

/** Resume serving is optional locally; say plainly what its absence means. */
function checkResumeServing(): CheckResult {
  const origin = config().PUBLIC_BASE_URL
  if (origin)
    return {
      status: 'pass',
      name: 'Resume files',
      detail: `Jobo will download resumes from ${origin}`,
    }
  return {
    status: 'warn',
    name: 'Resume files',
    detail:
      'PUBLIC_BASE_URL is not set, so resume upload fields are skipped and applications that require a resume stop. Fine for UI work; set it (or use an HTTPS tunnel) to complete applications.',
  }
}

/** Run every check concurrently. Assumes the environment itself is valid. */
export async function runPreflight(): Promise<CheckResult[]> {
  return Promise.all([
    checkDatabase(),
    checkJoboKey(),
    checkOpenRouter(),
    checkBrevo(),
    checkSandbox(),
    Promise.resolve(checkResumeServing()),
  ])
}
