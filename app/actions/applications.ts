'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { applications } from '@/db/schema'
import { callbackUrl, config } from '@/lib/config'
import { JoboAPIError } from '@jobo-ai/autoapply'
import { jobo } from '@/lib/jobo/client'
import { explain } from '@/lib/jobo/problem'
import { isTerminal } from '@/lib/status'
import { log } from '@/lib/logger'

export interface CreateInput {
  profileId: string
  applyUrl: string
  sandbox: boolean
  scenarioSlug?: string
}

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; error: string; code?: string }

/**
 * Enforced here rather than in the form, because the form is not the only way
 * in — this is a server action, and anything that can POST to the app can call
 * it with a URL of its choosing. Runs before the local row is written, so a
 * refused attempt leaves nothing behind.
 */
function sandboxOnlyRefusal(applyUrl: string): string | null {
  const c = config()
  if (!c.DEMO_SANDBOX_ONLY) return null
  let host: string
  try {
    host = new URL(applyUrl).hostname
  } catch {
    return 'That is not a valid URL.'
  }
  if (host === c.SANDBOX_HOST) return null
  return `This deployment only applies to ${c.SANDBOX_HOST} scenarios. Run it yourself to apply to a real posting.`
}

/**
 * Create an application.
 *
 * The ordering here is the point. The local row and its Idempotency-Key are
 * written BEFORE the network call, because if that call times out we cannot
 * know whether Jobo accepted it — and the only safe retry is one that reuses
 * the exact same key. A key generated after a failure is a key that can create
 * a duplicate application.
 */
export async function createApplicationAction(input: CreateInput): Promise<CreateResult> {
  const refusal = sandboxOnlyRefusal(input.applyUrl)
  if (refusal) {
    log.warn({ applyUrl: input.applyUrl }, 'refused a non-sandbox apply URL')
    return { ok: false, error: refusal, code: 'sandbox_only' }
  }

  const id = randomUUID()
  const idempotencyKey = randomUUID()

  db.insert(applications)
    .values({
      id,
      idempotencyKey,
      profileId: input.profileId,
      applyUrl: input.applyUrl,
      sandbox: input.sandbox,
      scenarioSlug: input.scenarioSlug ?? null,
      status: 'creating'
    })
    .run()

  try {
    const created = await jobo().applications.create(
      {
        apply_url: input.applyUrl,
        // Always sent explicitly, so the app works whether or not an account
        // default is configured, and so the UI can show exactly which URL Jobo
        // will call.
        callback_url: callbackUrl()
        // No `sandbox` flag: sandbox mode is a property of the credential you
        // call with, not of the request. The API ignores unknown keys.
      },
      { idempotencyKey }
    )

    db.update(applications)
      .set({
        joboApplicationId: created.id,
        status: created.status,
        providerId: created.provider_id,
        providerName: created.provider_name,
        lastSyncedAt: Date.now(),
        updatedAt: Date.now()
      })
      .where(eq(applications.id, id))
      .run()

    log.info({ id, joboId: created.id, provider: created.provider_name }, 'created application')
    revalidatePath('/applications')
    return { ok: true, id }
  } catch (error) {
    const isApiError = error instanceof JoboAPIError
    const message = isApiError ? explain(error) : String(error)
    const code = isApiError ? error.code : 'network_error'

    db.update(applications)
      .set({
        status: 'create_failed',
        createErrorCode: code,
        createErrorMessage: message,
        updatedAt: Date.now()
      })
      .where(eq(applications.id, id))
      .run()

    log.warn({ id, code, message }, 'create failed')
    revalidatePath('/applications')
    return { ok: false, error: message, code }
  }
}

export async function cancelApplicationAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const local = db.select().from(applications).where(eq(applications.id, id)).get()
  if (!local?.joboApplicationId) return { ok: false, error: 'This application was never created.' }

  try {
    const summary = await jobo().applications.cancel(local.joboApplicationId)
    db.update(applications)
      .set({ status: summary.status, lastSyncedAt: Date.now(), updatedAt: Date.now() })
      .where(eq(applications.id, id))
      .run()
    revalidatePath(`/applications/${id}`)
    return { ok: true }
  } catch (error) {
    const message = explain(error)
    return { ok: false, error: message }
  }
}

/**
 * Pull the authoritative state from Jobo.
 *
 * Webhooks are the primary signal; this exists for the gaps — a tunnel that was
 * down, an event still being retried, or a page loaded mid-flight.
 */
export async function syncApplicationAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const local = db.select().from(applications).where(eq(applications.id, id)).get()
  if (!local?.joboApplicationId) return { ok: false, error: 'Nothing to sync.' }

  try {
    const detail = await jobo().applications.get(local.joboApplicationId)
    db.update(applications)
      .set({
        status: detail.status,
        providerId: detail.provider_id,
        providerName: detail.provider_name,
        failureCode: detail.failure?.code ?? null,
        failureMessage: detail.failure?.message ?? null,
        failureRetryable: detail.failure?.retryable ?? null,
        lastSyncedAt: Date.now(),
        updatedAt: Date.now()
      })
      .where(eq(applications.id, id))
      .run()
    revalidatePath(`/applications/${id}`)
    return { ok: true }
  } catch (error) {
    const message = explain(error)
    return { ok: false, error: message }
  }
}

/** Server-side helper for the detail page: refresh if stale and still open. */
export async function refreshIfStale(id: string, maxAgeMs = 3_000): Promise<void> {
  const local = db.select().from(applications).where(eq(applications.id, id)).get()
  if (!local?.joboApplicationId) return
  if (isTerminal(local.status)) return
  if (local.lastSyncedAt && Date.now() - local.lastSyncedAt < maxAgeMs) return
  await syncApplicationAction(id)
}
