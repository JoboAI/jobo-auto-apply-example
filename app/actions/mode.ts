'use server'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/session'
import { verifyApiKey } from '@/lib/jobo/jobs-api'
import {
  connectApiKey,
  forgetApiKey,
  getDemoSettings,
  productionAvailable,
  setDemoMode,
} from '@/lib/user-settings'

type Result = { ok: true } | { ok: false; error: string }

const NOT_CONFIGURED: Result = {
  ok: false,
  error: 'Production mode is not configured on this deployment.',
}

/** Verify the visitor's key against Jobo, store it sealed, switch to production. */
export async function connectProductionAction(input: {
  apiKey: string
  acknowledged: boolean
}): Promise<Result> {
  const user = await requireUser()
  if (!productionAvailable()) return NOT_CONFIGURED
  const settings = await getDemoSettings(user.id)
  if (!settings.acknowledged && !input.acknowledged)
    return {
      ok: false,
      error: 'Confirm you understand that production applications go to real employers.',
    }
  const apiKey = input.apiKey.trim()
  const verified = await verifyApiKey(apiKey)
  if (!verified.ok) return verified
  await connectApiKey(user.id, apiKey)
  revalidatePath('/', 'layout')
  return { ok: true }
}

/** Flip modes with an already-connected key. */
export async function setModeAction(mode: 'sandbox' | 'production'): Promise<Result> {
  const user = await requireUser()
  if (mode === 'production') {
    const settings = await getDemoSettings(user.id)
    if (!settings.productionAvailable) return NOT_CONFIGURED
    if (!settings.hasKey) return { ok: false, error: 'Connect your Jobo API key first.' }
  }
  await setDemoMode(user.id, mode === 'production' ? 'production' : 'sandbox')
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function forgetApiKeyAction(): Promise<Result> {
  const user = await requireUser()
  await forgetApiKey(user.id)
  revalidatePath('/', 'layout')
  return { ok: true }
}
