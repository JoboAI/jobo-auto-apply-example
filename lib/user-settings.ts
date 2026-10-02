import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { userSettings } from '@/db/schema'
import { config } from '@/lib/config'
import { open, seal } from '@/lib/secret-box'

/**
 * Sandbox vs production, per visitor.
 *
 * Sandbox is the default and needs nothing: fictional jobs, the deployment's
 * own key. Production uses the visitor's Jobo API key for job search and for
 * applications, so it is only offered when the deployment has
 * API_KEY_ENCRYPTION_SECRET to store that key with.
 */
export type DemoMode = 'sandbox' | 'production'

export interface DemoSettings {
  mode: DemoMode
  hasKey: boolean
  keyHint: string | null
  acknowledged: boolean
  /** False when this deployment cannot store keys at all. */
  productionAvailable: boolean
}

export function productionAvailable(): boolean {
  return !!config().API_KEY_ENCRYPTION_SECRET
}

function secret(): string {
  const value = config().API_KEY_ENCRYPTION_SECRET
  if (!value) throw new Error('Production mode is not configured on this deployment.')
  return value
}

export function sealApiKey(apiKey: string): string {
  return seal(apiKey, secret())
}

export function openApiKey(ciphertext: string): string {
  return open(ciphertext, secret())
}

async function row(userId: string) {
  const [found] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1)
  return found
}

export async function getDemoSettings(userId: string): Promise<DemoSettings> {
  const found = await row(userId)
  const available = productionAvailable()
  const hasKey = !!found?.apiKeyCiphertext
  return {
    // A deployment that lost its secret falls back to sandbox rather than
    // offering a mode whose key it can no longer read.
    mode: available && hasKey && found?.mode === 'production' ? 'production' : 'sandbox',
    hasKey: available && hasKey,
    keyHint: found?.apiKeyHint ?? null,
    acknowledged: !!found?.productionAcknowledgedAt,
    productionAvailable: available,
  }
}

/**
 * The visitor's key, sealed, only while they are in production mode. This is
 * what an application snapshots when it is queued.
 */
export async function productionKeyCiphertext(userId: string): Promise<string | null> {
  const found = await row(userId)
  if (!productionAvailable() || found?.mode !== 'production') return null
  return found.apiKeyCiphertext ?? null
}

/** The plaintext key for job search, or null outside production mode. */
export async function productionApiKey(userId: string): Promise<string | null> {
  const ciphertext = await productionKeyCiphertext(userId)
  return ciphertext ? openApiKey(ciphertext) : null
}

export async function connectApiKey(userId: string, apiKey: string) {
  const values = {
    mode: 'production' as const,
    apiKeyCiphertext: sealApiKey(apiKey),
    apiKeyHint: apiKey.slice(-4),
    productionAcknowledgedAt: Date.now(),
    updatedAt: Date.now(),
  }
  await db
    .insert(userSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userSettings.userId, set: values })
}

export async function setDemoMode(userId: string, mode: DemoMode) {
  await db
    .insert(userSettings)
    .values({ userId, mode, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { mode, updatedAt: Date.now() },
    })
}

/**
 * Forget the key and return to sandbox. Applications already queued keep
 * their own sealed copy so a run in flight can finish; that copy is cleared
 * when each one reaches a terminal state.
 */
export async function forgetApiKey(userId: string) {
  await db
    .insert(userSettings)
    .values({ userId, mode: 'sandbox', updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: {
        mode: 'sandbox',
        apiKeyCiphertext: null,
        apiKeyHint: null,
        updatedAt: Date.now(),
      },
    })
}
