import { openApiKey, storedKeyCiphertext } from '@/lib/user-settings'
import { SANDBOX_ATS, supportedAts, type SupportedAts } from './supported-ats'

/**
 * Sandbox or production, from the visitor's own Jobo API key. Both run the
 * same code (search, job pages, company profiles, applications) against the
 * same API, JOBO_API_BASE_URL. The key's prefix picks the data:
 *
 *                API key                  jobs
 *   sandbox      jbe_test_…               fictional, on the sandbox ATS
 *   production   jbe_live_… (or jbe_…)    live, on supported ATSes
 *
 * Like a payments test mode, a sandbox key gets the same endpoints and
 * response shapes, free, and every application lands on a sandbox form. Its
 * applications are invisible to live keys and vice versa, so each application
 * runs on the key it was queued with (lib/application-engine.ts).
 * See https://docs.jobo.world/sandbox.
 */
export type JoboMode = 'sandbox' | 'production'

export interface JoboEnvironment {
  mode: JoboMode
  apiKey: string
}

/** Sandbox keys are answered from sandbox data, wherever they are sent. */
export function isSandboxKey(apiKey: string): boolean {
  return apiKey.startsWith('jbe_test_')
}

/** Every other Jobo key, including legacy `jbe_` ones, is a production key. */
export function keyMode(apiKey: string): JoboMode {
  return isSandboxKey(apiKey) ? 'sandbox' : 'production'
}

export function environmentForKey(apiKey: string): JoboEnvironment {
  return { mode: keyMode(apiKey), apiKey }
}

/**
 * The visitor's environment, with the sealed key a queued application keeps,
 * or null until they connect a key (the onboarding asks for one).
 */
export async function visitorEnvironment(
  userId: string,
): Promise<(JoboEnvironment & { apiKeyCiphertext: string }) | null> {
  const ciphertext = await storedKeyCiphertext(userId)
  if (!ciphertext) return null
  let apiKey: string
  try {
    apiKey = openApiKey(ciphertext)
  } catch {
    return null // sealed under a rotated API_KEY_ENCRYPTION_SECRET: connect again
  }
  return { ...environmentForKey(apiKey), apiKeyCiphertext: ciphertext }
}

/**
 * The ATSes an environment's jobs are searched across and applied through:
 * the `sources` filter on every search, so each job shown can be applied to.
 */
export async function environmentAts(env: JoboEnvironment): Promise<SupportedAts[]> {
  return env.mode === 'sandbox' ? [SANDBOX_ATS] : supportedAts()
}
