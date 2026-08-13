import { z } from 'zod'
import { config } from './config'
import { responseFormat } from './json-schema'

/**
 * A single, small OpenRouter wrapper.
 *
 * The only subtle thing here is structured output. See lib/json-schema.ts for
 * why the schema must have `additionalProperties: false` and list every
 * property in `required` — get that wrong and strict mode silently turns off.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export class OpenRouterError extends Error {
  readonly status: number | null
  /** Auth and billing problems are never worth retrying. */
  readonly isAuthError: boolean

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'OpenRouterError'
    this.status = status
    this.isAuthError = status === 401 || status === 402 || status === 403
  }
}

export interface CompletionOptions<T extends z.ZodTypeAny> {
  model: string
  system: string
  user: string
  schema: T
  schemaName: string
  /** Hard wall-clock ceiling. The caller derives this from the event deadline. */
  timeoutMs: number
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  /**
   * Turn the model's reasoning pass off. Worth doing whenever the output is a
   * strict JSON schema and the work is extraction rather than deduction: the
   * reasoning tokens are billed, they count against the response deadline, and
   * they are discarded — nothing here ever reads them. Models that cannot
   * disable it ignore the field.
   */
  reasoning?: boolean
}

export interface CompletionResult<T> {
  data: T
  model: string
  elapsedMs: number
}

/**
 * One structured completion. One attempt — no internal retry.
 *
 * On the answer path a retry would risk blowing the step deadline
 * (answers_expire_at, ~3 minutes) for a marginal gain, and the free
 * validation-and-repair loop is already the real retry mechanism.
 */
export async function complete<T extends z.ZodTypeAny>(
  options: CompletionOptions<T>
): Promise<CompletionResult<z.infer<T>>> {
  const c = config()
  const startedAt = Date.now()

  // Honour whichever deadline arrives first: our budget, or the caller's signal.
  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout

  let response: Response
  try {
    response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${c.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        ...(c.OPENROUTER_APP_URL ? { 'HTTP-Referer': c.OPENROUTER_APP_URL } : {}),
        ...(c.OPENROUTER_APP_NAME ? { 'X-Title': c.OPENROUTER_APP_NAME } : {})
      },
      body: JSON.stringify({
        model: options.model,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 4096,
        messages: [
          { role: 'system', content: options.system },
          { role: 'user', content: options.user }
        ],
        // OpenRouter's unified control; `exclude` also keeps the reasoning
        // out of the response body for providers that always produce it.
        ...(options.reasoning === false ? { reasoning: { enabled: false, exclude: true } } : {}),
        response_format: responseFormat(options.schemaName, options.schema)
      })
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new OpenRouterError(`OpenRouter timed out after ${options.timeoutMs}ms`)
    }
    throw new OpenRouterError(
      `OpenRouter request failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = (await response.json()) as { error?: { message?: string } }
      if (body.error?.message) detail = body.error.message
    } catch {
      // Non-JSON error body; the status line is all we have.
    }
    throw new OpenRouterError(`OpenRouter ${response.status}: ${detail}`, response.status)
  }

  const body = (await response.json()) as {
    model?: string
    choices?: { message?: { content?: string } }[]
  }
  const content = body.choices?.[0]?.message?.content
  if (!content) {
    throw new OpenRouterError('OpenRouter returned no message content')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new OpenRouterError(`OpenRouter returned non-JSON content: ${content.slice(0, 200)}`)
  }

  const validated = options.schema.safeParse(parsed)
  if (!validated.success) {
    // Reaching here usually means strict mode was not actually in effect — the
    // most common cause is a schema whose `required` list is incomplete.
    throw new OpenRouterError(
      `OpenRouter response did not match the schema: ${validated.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    )
  }

  return {
    data: validated.data,
    model: body.model ?? options.model,
    elapsedMs: Date.now() - startedAt
  }
}
