'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUser } from '@/lib/session'
import { verifyApiKey } from '@/lib/jobo/jobs-api'
import { keyMode } from '@/lib/jobo/environment'
import { connectApiKey, forgetApiKey, getKeySettings } from '@/lib/user-settings'

/**
 * Connecting, replacing and forgetting the visitor's own Jobo API key. The
 * key's prefix decides sandbox or production; see lib/jobo/environment.ts.
 */

type Result = { ok: true } | { ok: false; error: string }

const connectInput = z.object({
  apiKey: z.string().trim().min(1).max(500),
  acknowledged: z.boolean(),
})

/**
 * Verify the key against Jobo, then store it sealed. A production key also
 * needs the one-time "real employers" acknowledgement.
 */
export async function connectApiKeyAction(raw: z.input<typeof connectInput>): Promise<Result> {
  const user = await requireUser()
  const parsed = connectInput.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Paste your Jobo API key.' }
  const { apiKey, acknowledged } = parsed.data
  const production = keyMode(apiKey) === 'production'
  if (production && !acknowledged && !(await getKeySettings(user.id)).acknowledged)
    return {
      ok: false,
      error: 'Confirm you understand that production applications go to real employers.',
    }
  const verified = await verifyApiKey(apiKey)
  if (!verified.ok) return verified
  await connectApiKey(user.id, apiKey, production && acknowledged)
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function forgetApiKeyAction(): Promise<Result> {
  const user = await requireUser()
  await forgetApiKey(user.id)
  revalidatePath('/', 'layout')
  return { ok: true }
}
