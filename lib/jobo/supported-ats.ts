import { z } from 'zod'
import { config } from '@/lib/config'

/**
 * The ATSes Auto Apply can route an application to.
 *
 * Jobo publishes them anonymously on its status page API. An Auto Apply
 * provider id is the same id the job catalog uses for a job's `source`, so
 * this list doubles as the `sources` filter for job search: production mode
 * only ever shows jobs Auto Apply can actually apply to.
 *
 * `jobosandbox` is Jobo's own test ATS; its jobs live in sandbox mode.
 */
export interface SupportedAts {
  id: string
  name: string
}

/** Used when the status API is unreachable, so search still works. */
export const FALLBACK_ATS: readonly SupportedAts[] = [
  { id: 'ashby', name: 'Ashby' },
  { id: 'greenhouse', name: 'Greenhouse' },
  { id: 'lever', name: 'Lever' },
  { id: 'smartrecruiters', name: 'SmartRecruiters' },
  { id: 'workable', name: 'Workable' },
  { id: 'workday', name: 'Workday' },
]

const SANDBOX_PROVIDER = 'jobosandbox'
const TTL_MS = 10 * 60 * 1000

const statusSchema = z.object({
  auto_apply_providers: z.array(
    z.object({ provider_id: z.string(), display_name: z.string() }),
  ),
})

let cached: { at: number; list: SupportedAts[] } | null = null

export async function supportedAts(
  fetchImpl: typeof fetch = fetch,
): Promise<SupportedAts[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.list
  try {
    const response = await fetchImpl(config().JOBO_STATUS_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const list = statusSchema
      .parse(await response.json())
      .auto_apply_providers.filter((p) => p.provider_id !== SANDBOX_PROVIDER)
      .map((p) => ({ id: p.provider_id, name: p.display_name }))
    if (!list.length) throw new Error('empty provider list')
    cached = { at: Date.now(), list }
    return list
  } catch {
    // Not cached: the next request retries the live list.
    return [...FALLBACK_ATS]
  }
}

/** For tests. */
export function resetSupportedAtsCache() {
  cached = null
}
