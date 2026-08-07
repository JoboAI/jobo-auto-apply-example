/**
 * Which apply URLs a shared deployment will accept.
 *
 * Pure on purpose: the server action reads `config()`, which caches on first
 * call, so a matcher that reached for config itself could not be exercised
 * against more than one allowlist.
 */

/** Split the comma-separated env value into comparable hostnames. */
export function parseAllowedHosts(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Exact hostname match, or an explicit `.suffix` entry.
 *
 * Never a bare `endsWith`. `endsWith('greenhouse.io')` also accepts
 * `evil-greenhouse.io` and `greenhouse.io.attacker.test`, either of which would
 * let a visitor submit a real application on this deployment's key. Requiring
 * an entry to start with a dot, and the host to end with that exact dotted
 * suffix, means only genuine subdomains match.
 */
export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const target = host.trim().toLowerCase()
  if (!target) return false
  return allowed.some((entry) =>
    entry.startsWith('.') ? target.endsWith(entry) : target === entry
  )
}

/**
 * The hosts the demo deployment accepts.
 *
 * Exact hostnames rather than a `.greenhouse.io` suffix, because these are the
 * board hosts Jobo's own provider adapters match — see the url patterns in
 * the ApplyAdapters module's Config. Anything else on those domains is not a job board.
 */
export const ATS_HOSTS = [
  'sandbox.jobo.world',
  'jobs.ashbyhq.com',
  'boards.greenhouse.io',
  'boards.eu.greenhouse.io',
  'job-boards.greenhouse.io',
  'job-boards.eu.greenhouse.io'
] as const
