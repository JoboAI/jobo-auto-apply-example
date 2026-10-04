import { z } from 'zod'
import { config } from '@/lib/config'
import { SANDBOX_ATS_ID } from '@/lib/jobs'

/**
 * The ATSes Auto Apply can route an application to.
 *
 * Jobo publishes them anonymously on its status page API. An Auto Apply
 * provider id is the same id the job catalog uses for a job's `source`, so
 * this list doubles as the `sources` filter for job search: production mode
 * only ever shows jobs Auto Apply can actually apply to.
 *
 * `jobosandbox` is Jobo's own test ATS. It is left out here, and is the only
 * ATS in sandbox mode (SANDBOX_ATS, see lib/jobo/environment.ts).
 */
export interface SupportedAts {
  id: string
  name: string
  /** The ATS's mark, from `public/ats-logos/`. */
  logoUrl?: string
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

const TTL_MS = 10 * 60 * 1000

const statusSchema = z.object({
  auto_apply_providers: z.array(z.object({ provider_id: z.string(), display_name: z.string() })),
})

let cached: { at: number; list: SupportedAts[] } | null = null

export async function supportedAts(fetchImpl: typeof fetch = fetch): Promise<SupportedAts[]> {
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
      .auto_apply_providers.filter((p) => p.provider_id !== SANDBOX_ATS_ID)
      .map((p) => ({ id: p.provider_id, name: p.display_name }))
    if (!list.length) throw new Error('empty provider list')
    cached = { at: Date.now(), list: withLogos(list) }
    return cached.list
  } catch {
    // Not cached: the next request retries the live list.
    return withLogos(FALLBACK_ATS)
  }
}

/**
 * ATS marks shipped with this app in `public/ats-logos/`, so the demo needs
 * nothing beyond the public API to show them. Add a file here when Auto Apply
 * gains a provider; until then that ATS shows by name only.
 */
const ATS_LOGOS: Record<string, string> = {
  ashby: '/ats-logos/ashby.png',
  greenhouse: '/ats-logos/greenhouse.png',
  lever: '/ats-logos/lever.png',
  smartrecruiters: '/ats-logos/smartrecruiters.png',
  workable: '/ats-logos/workable.png',
  workday: '/ats-logos/workday.png',
  [SANDBOX_ATS_ID]: '/favicon.svg',
}

export function atsLogo(id: string | null | undefined): string | undefined {
  return id ? ATS_LOGOS[id.toLowerCase()] : undefined
}

/** Sandbox mode's one ATS: the forms on sandbox.jobo.world. */
export const SANDBOX_ATS: SupportedAts = {
  id: SANDBOX_ATS_ID,
  name: 'Jobo Sandbox',
  logoUrl: atsLogo(SANDBOX_ATS_ID),
}

function withLogos(list: readonly SupportedAts[]): SupportedAts[] {
  return list.map((a) => ({ ...a, ...(atsLogo(a.id) ? { logoUrl: atsLogo(a.id) } : {}) }))
}

/** For tests. */
export function resetSupportedAtsCache() {
  cached = null
}
