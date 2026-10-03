'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUser } from '@/lib/session'
import { verifyApiKey } from '@/lib/jobo/jobs-api'
import {
  connectApiKey,
  forgetApiKey,
  getDemoSettings,
  productionAvailable,
  setDemoMode,
} from '@/lib/user-settings'

/**
 * Sandbox ↔ production mode, and the visitor's own Jobo API key.
 * See lib/user-settings.ts for how the key is stored.
 */

type Result = { ok: true } | { ok: false; error: string }

const connectInput = z.object({
  apiKey: z.string().trim().min(1).max(500),
  acknowledged: z.boolean(),
})

const NOT_CONFIGURED: Result = {
  ok: false,
  error: 'Production mode is not configured on this deployment.',
}

/** Verify the visitor's key against Jobo, store it sealed, switch to production. */
export async function connectProductionAction(raw: z.input<typeof connectInput>): Promise<Result> {
  const user = await requireUser()
  if (!productionAvailable()) return NOT_CONFIGURED
  const parsed = connectInput.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Paste your Jobo API key.' }
  const input = parsed.data
  const settings = await getDemoSettings(user.id)
  if (!settings.acknowledged && !input.acknowledged)
    return {
      ok: false,
      error: 'Confirm you understand that production applications go to real employers.',
    }
  const verified = await verifyApiKey(input.apiKey)
  if (!verified.ok) return verified
  await connectApiKey(user.id, input.apiKey)
  revalidatePath('/', 'layout')
  return { ok: true }
}

/** Flip modes with an already-connected key. */
export async function setModeAction(rawMode: 'sandbox' | 'production'): Promise<Result> {
  const user = await requireUser()
  const mode = rawMode === 'production' ? 'production' : 'sandbox'
  if (mode === 'production') {
    const settings = await getDemoSettings(user.id)
    if (!settings.productionAvailable) return NOT_CONFIGURED
    if (!settings.hasKey) return { ok: false, error: 'Connect your Jobo API key first.' }
  }
  await setDemoMode(user.id, mode)
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function forgetApiKeyAction(): Promise<Result> {
  const user = await requireUser()
  await forgetApiKey(user.id)
  revalidatePath('/', 'layout')
  return { ok: true }
}
