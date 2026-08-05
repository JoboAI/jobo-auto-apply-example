import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { config } from './config'

/**
 * Network preflight checks, shared by `npm run doctor` and the tutorial's
 * "Run preflight" action. Each corresponds to a real failure that is painful
 * to diagnose from the far side — an application that sits in `queued` and
 * dies with `callback_unavailable` says nothing about WHICH of these was
 * wrong.
 */

export interface CheckResult {
  status: 'pass' | 'fail' | 'warn' | 'info'
  name: string
  detail: string
}

/** Private ranges Jobo's SSRF guard rejects. */
function isPrivateAddress(address: string): boolean {
  if (address.startsWith('127.') || address === '::1') return true
  if (address.startsWith('10.')) return true
  if (address.startsWith('192.168.')) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return true
  if (address.startsWith('169.254.')) return true
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)) return true // CGNAT
  if (/^(fc|fd)/i.test(address)) return true // unique local IPv6
  return false
}

async function checkPublicDns(): Promise<CheckResult> {
  const origin = new URL(config().PUBLIC_BASE_URL)
  try {
    const addresses = isIP(origin.hostname)
      ? [{ address: origin.hostname }]
      : await lookup(origin.hostname, { all: true })
    const list = addresses.map((a) => a.address)
    const priv = list.filter(isPrivateAddress)
    if (priv.length > 0) {
      return {
        status: 'fail',
        name: 'Public DNS',
        detail: `${origin.hostname} resolves to a private address (${priv.join(', ')}). Jobo will refuse it.`
      }
    }
    return { status: 'pass', name: 'Public DNS', detail: `${origin.hostname} → ${list.join(', ')}` }
  } catch (error) {
    return {
      status: 'fail',
      name: 'Public DNS',
      detail: `${origin.hostname} does not resolve (${error instanceof Error ? error.message : error})`
    }
  }
}

async function checkTunnel(): Promise<CheckResult> {
  const base = config().PUBLIC_BASE_URL
  try {
    const response = await fetch(`${base}/api/health`, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'jobo-doctor' },
      cache: 'no-store'
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok) {
      return { status: 'fail', name: 'Tunnel reachable', detail: `GET /api/health returned ${response.status}` }
    }
    if (!contentType.includes('application/json')) {
      // The ngrok free-tier interstitial lands exactly here — and it is also
      // what makes a `file` field fail with invalid_file_type later.
      return {
        status: 'fail',
        name: 'Tunnel reachable',
        detail: `/api/health returned ${contentType}, not JSON. Something is intercepting requests (an ngrok browser interstitial does this).`
      }
    }
    return { status: 'pass', name: 'Tunnel reachable', detail: `${base}/api/health responds through the public internet` }
  } catch (error) {
    return {
      status: 'fail',
      name: 'Tunnel reachable',
      detail: `could not reach ${base}/api/health — are the dev server and tunnel running? (${error instanceof Error ? error.message : error})`
    }
  }
}

async function checkClockSkew(): Promise<CheckResult> {
  // A skewed clock rejects every single webhook with a timestamp-tolerance
  // failure, and nothing else looks wrong. Worth its own check.
  try {
    const response = await fetch(`${config().JOBO_API_BASE_URL}/api/auto-apply/sandbox/scenarios`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store'
    })
    const serverDate = response.headers.get('date')
    if (!serverDate) return { status: 'warn', name: 'Clock skew', detail: 'no Date header to compare against' }
    const skew = Math.abs(Date.now() - Date.parse(serverDate)) / 1000
    if (skew > 240) {
      return { status: 'fail', name: 'Clock skew', detail: `${skew.toFixed(0)}s off — every webhook will fail the 300s signature tolerance` }
    }
    if (skew > 60) return { status: 'warn', name: 'Clock skew', detail: `${skew.toFixed(0)}s off — tolerable but worth fixing` }
    return { status: 'pass', name: 'Clock skew', detail: `${skew.toFixed(0)}s` }
  } catch {
    return { status: 'warn', name: 'Clock skew', detail: 'could not reach Jobo to compare clocks' }
  }
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

/** Run every network check concurrently. Assumes configIssues() is empty. */
export async function runPreflight(): Promise<CheckResult[]> {
  return Promise.all([
    checkPublicDns(),
    checkTunnel(),
    checkClockSkew(),
    checkOpenRouter(),
    checkJoboKey(),
    checkSandbox()
  ])
}
