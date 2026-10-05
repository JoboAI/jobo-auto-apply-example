import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { userSettings } from '@/db/schema'
import { config } from '@/lib/config'
import { open, seal } from '@/lib/secret-box'
import { keyMode, type JoboMode } from '@/lib/jobo/environment'
import { AI_CONSENT_VERSION } from '@/lib/ai-consent'

/**
 * The visitor's own Jobo API key, which every Jobo call they cause uses.
 * Stored sealed (lib/secret-box.ts) because the background worker needs it
 * after the browser has gone. Its prefix picks sandbox or production
 * (lib/jobo/environment.ts); switching is replacing the key.
 */
export interface KeySettings {
  /** Null until the visitor connects a key. */
  mode: JoboMode | null
  keyHint: string | null
  /** The one-time "production applications go to real employers" warning. */
  acknowledged: boolean
}

export function sealApiKey(apiKey: string): string {
  return seal(apiKey, config().API_KEY_ENCRYPTION_SECRET)
}

export function openApiKey(ciphertext: string): string {
  return open(ciphertext, config().API_KEY_ENCRYPTION_SECRET)
}

async function row(userId: string) {
  const [found] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1)
  return found
}

export async function getKeySettings(userId: string): Promise<KeySettings> {
  const found = await row(userId)
  let mode: JoboMode | null = null
  try {
    if (found?.apiKeyCiphertext) mode = keyMode(openApiKey(found.apiKeyCiphertext))
  } catch {
    // Sealed under a rotated API_KEY_ENCRYPTION_SECRET: treated as no key.
  }
  return {
    mode,
    keyHint: mode ? (found?.apiKeyHint ?? null) : null,
    acknowledged: !!found?.productionAcknowledgedAt,
  }
}

/** The visitor's key, sealed: what an application snapshots when it is queued. */
export async function storedKeyCiphertext(userId: string): Promise<string | null> {
  return (await row(userId))?.apiKeyCiphertext ?? null
}

/** Store a verified key. `acknowledged` records the production warning. */
export async function connectApiKey(userId: string, apiKey: string, acknowledged: boolean) {
  const values = {
    apiKeyCiphertext: sealApiKey(apiKey),
    apiKeyHint: apiKey.slice(-4),
    ...(acknowledged ? { productionAcknowledgedAt: Date.now() } : {}),
    updatedAt: Date.now(),
  }
  await db
    .insert(userSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userSettings.userId, set: values })
}

/** Whether the visitor accepted the current AI-answers wording (lib/ai-consent.ts). */
export async function hasAiAnswersConsent(userId: string): Promise<boolean> {
  const found = await row(userId)
  return !!found?.aiAnswersConsentAt && found.aiAnswersConsentVersion === AI_CONSENT_VERSION
}

/** Record the visitor's explicit acceptance of the current AI-answers wording. */
export async function recordAiAnswersConsent(userId: string) {
  const values = {
    aiAnswersConsentAt: Date.now(),
    aiAnswersConsentVersion: AI_CONSENT_VERSION,
    updatedAt: Date.now(),
  }
  await db
    .insert(userSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userSettings.userId, set: values })
}

/**
 * Forget the key; the visitor connects one again before the next search.
 * Applications already queued keep their own sealed copy so a run in flight
 * can finish; that copy is cleared when each one reaches a terminal state.
 */
export async function forgetApiKey(userId: string) {
  await db
    .update(userSettings)
    .set({ apiKeyCiphertext: null, apiKeyHint: null, updatedAt: Date.now() })
    .where(eq(userSettings.userId, userId))
}
