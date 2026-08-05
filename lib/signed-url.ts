import { createHmac, timingSafeEqual } from 'node:crypto'
import { config, publicUrl } from './config'

/**
 * Short-lived signed URLs for resume downloads.
 *
 * Jobo fetches a `file` field's URL itself, from its own infrastructure, with
 * no credentials of ours. So the URL has to authenticate itself — but it also
 * ends up in logs and in the application record, so it must not be a permanent
 * public link to someone's resume. A signed, expiring URL is the middle ground.
 *
 * Jobo's constraints on this URL, all enforced server-side:
 *   - absolute https, port 443 only
 *   - resolves to a public IP (SSRF guard)
 *   - at most 3 redirects, 30s download timeout, 10 MiB max
 */

/** Comfortably longer than the 120s callback window, still short-lived. */
const DEFAULT_TTL_SECONDS = 15 * 60

function sign(profileId: string, expiresAt: number): string {
  return createHmac('sha256', config().RESUME_URL_SIGNING_SECRET)
    .update(`${profileId}.${expiresAt}`)
    .digest('hex')
}

export function signResumeUrl(profileId: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds
  const token = sign(profileId, expiresAt)
  return publicUrl(`/api/resumes/${profileId}?exp=${expiresAt}&token=${token}`)
}

export type ResumeUrlVerification = { ok: true } | { ok: false; reason: 'expired' | 'invalid' }

export function verifyResumeUrl(
  profileId: string,
  exp: string | null,
  token: string | null
): ResumeUrlVerification {
  if (!exp || !token) return { ok: false, reason: 'invalid' }

  const expiresAt = Number(exp)
  if (!Number.isInteger(expiresAt)) return { ok: false, reason: 'invalid' }
  if (expiresAt < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'expired' }

  const expected = sign(profileId, expiresAt)
  if (token.length !== expected.length) return { ok: false, reason: 'invalid' }
  try {
    const matches = timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'))
    return matches ? { ok: true } : { ok: false, reason: 'invalid' }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}
