import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The webhook route, end to end through `@jobo-ai/autoapply`'s
 * `createCallbackHandler`.
 *
 * The answer engine has its own tests; what is checked here is the contract
 * behaviour that lives in the wiring, and that a naive port would quietly
 * break: signature rejection, the portal ping, and — the expensive one —
 * never returning a non-2xx when our own side fails.
 */

const SECRET = 'whsec_test_secret_for_the_route_suite'

// Set before the route (and therefore lib/config) is ever imported.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'jobo-webhook-route-'))
process.env.JOBO_API_KEY = 'jbe_test_key'
process.env.JOBO_WEBHOOK_SECRET = SECRET
process.env.PUBLIC_BASE_URL = 'https://example.com'
process.env.RESUME_URL_SIGNING_SECRET = 'a'.repeat(32)
process.env.OPENROUTER_API_KEY = 'sk-or-v1-test'

let POST: (request: Request) => Promise<Response>
let signPayload: typeof import('@jobo-ai/autoapply').signPayload

beforeAll(async () => {
  ;({ POST } = await import('@/app/api/jobo/webhook/route'))
  ;({ signPayload } = await import('@jobo-ai/autoapply'))
})

async function deliver(
  payload: Record<string, unknown>,
  overrides: { secret?: string; signature?: string; attempt?: number } = {}
): Promise<Response> {
  const body = JSON.stringify(payload)
  const eventId = payload.id as string
  const timestamp = Math.floor(Date.now() / 1000)
  const signature =
    overrides.signature ?? `v1=${await signPayload(eventId, timestamp, body, overrides.secret ?? SECRET)}`
  return POST(
    new Request('https://example.com/api/jobo/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-jobo-webhook-id': eventId,
        'x-jobo-webhook-timestamp': String(timestamp),
        'x-jobo-webhook-signature': signature,
        'x-jobo-delivery-attempt': String(overrides.attempt ?? 1)
      },
      body
    })
  )
}

function fieldsRequested(id: string, applicationId: string) {
  return {
    id,
    type: 'application.fields_requested',
    api_version: '2026-07-21',
    attempt: 1,
    created_at: new Date().toISOString(),
    application: { id: applicationId, status: 'awaiting_answers' },
    step: {
      id: '6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8',
      sequence: 1,
      correction_round: 0,
      fields: [],
      command_errors: []
    }
  }
}

describe('POST /api/jobo/webhook', () => {
  it('rejects a forged signature with 401', async () => {
    const response = await deliver(fieldsRequested('evt_forged', 'app-1'), {
      signature: 'v1=deadbeef'
    })
    expect(response.status).toBe(401)
  })

  it('rejects a signature made with the wrong secret', async () => {
    const response = await deliver(fieldsRequested('evt_wrongkey', 'app-2'), {
      secret: 'whsec_not_the_configured_secret'
    })
    expect(response.status).toBe(401)
  })

  it('answers the portal verification ping with 200', async () => {
    // No `application` key — the shape that used to be rejected as
    // invalid_payload before the SDK knew about pings.
    const response = await deliver({
      id: 'evt_ping_route',
      type: 'application.ping',
      api_version: '2026-07-21',
      attempt: 1,
      created_at: new Date().toISOString()
    })
    expect(response.status).toBe(200)
  })

  it('cancels rather than failing when the application is unknown to us', async () => {
    // Rule 1: a non-2xx is NOT retried — it fails the application immediately
    // with callback_rejected. A cancel ends it cleanly instead.
    const response = await deliver(fieldsRequested('evt_unknown_app', 'app-never-created'))
    expect(response.status).toBe(200)

    const body = (await response.json()) as Record<string, unknown>
    expect(body.action).toBe('cancel')
    // `answers` must be ABSENT, not empty: the server checks key presence and
    // rejects {"action":"cancel","answers":[]} with answers_not_allowed.
    expect('answers' in body).toBe(false)
  })

  it('replays a retried event byte-identically instead of regenerating', async () => {
    const event = fieldsRequested('evt_replay', 'app-never-created')
    const first = await deliver(event)
    const second = await deliver(event, { attempt: 2 })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await second.text()).toBe(await first.text())
  })

  it('acknowledges an unknown event type so delivery stops retrying', async () => {
    const response = await deliver({
      id: 'evt_future',
      type: 'application.something_new',
      api_version: '2099-01-01',
      attempt: 1,
      created_at: new Date().toISOString(),
      application: { id: 'app-3', status: 'queued' }
    })
    expect(response.status).toBe(200)
  })
})
