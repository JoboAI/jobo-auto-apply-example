import { randomUUID } from 'node:crypto'
import { count, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { apiExchanges } from '@/db/schema'
import { jsonBody, previewJson, redactPreview } from './api-preview'

const MAX_EXCHANGES = 100
/** Wrap the SDK transport, including each retry, without changing its responses. */
export function recordingFetch(
  applicationId: string,
  secrets: string[],
  transport: typeof fetch = globalThis.fetch,
): typeof fetch {
  return async (input, init) => {
    const startedAt = Date.now()
    const id = randomUUID()
    let recorded = false
    try {
      const [{ recorded: existing }] = await db
        .select({ recorded: count() })
        .from(apiExchanges)
        .where(eq(apiExchanges.applicationId, applicationId))
      if (existing < MAX_EXCHANGES) {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
        const headers = new Headers(
          init?.headers ?? (input instanceof Request ? input.headers : undefined),
        )
        // Only non-credential headers are captured. Never persist all headers.
        const safeHeaders = Object.fromEntries(
          ['content-type', 'idempotency-key', 'jobo-api-version']
            .filter((key) => headers.has(key))
            .map((key) => [key, headers.get(key)]),
        )
        const body = typeof init?.body === 'string' ? jsonBody(init.body) : null
        await db.insert(apiExchanges).values({
          id,
          applicationId,
          method,
          url: String(redactPreview(url, secrets)),
          startedAt,
          requestJson: previewJson({ headers: safeHeaders, body }, secrets),
        })
        recorded = true
      }
    } catch {
      // Audit failures must not retry an otherwise successful API mutation.
      console.warn('API preview request capture unavailable', { applicationId })
    }
    const finish = async (values: Partial<typeof apiExchanges.$inferInsert>) => {
      if (!recorded) return
      try {
        await db
          .update(apiExchanges)
          .set({ ...values, finishedAt: Date.now(), elapsedMs: Date.now() - startedAt })
          .where(eq(apiExchanges.id, id))
      } catch {
        console.warn('API preview response capture unavailable', { applicationId })
      }
    }
    let response: Response
    try {
      response = await transport(input, init)
    } catch (error) {
      await finish({ error: 'No HTTP response received (connection failed or timed out).' })
      throw error
    }
    if (!recorded) return response
    try {
      const headers = Object.fromEntries(
        ['content-type', 'x-request-id', 'retry-after']
          .filter((key) => response.headers.has(key))
          .map((key) => [key, response.headers.get(key)]),
      )
      await finish({
        statusCode: response.status,
        responseJson: previewJson(
          { headers, body: jsonBody(await response.clone().text()) },
          secrets,
        ),
      })
    } catch {
      await finish({
        statusCode: response.status,
        error: 'HTTP response received, but its body could not be captured.',
      })
    }
    return response
  }
}
