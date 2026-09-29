import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
process.env.JOBO_API_KEY = 'jbe_test_fixture'
process.env.OPENROUTER_API_KEY = 'fixture-key'
process.env.RESUME_URL_SIGNING_SECRET = 'a'.repeat(32)
import { complete, OpenRouterError } from '@/lib/openrouter'
import { config } from '@/lib/config'
const options = {
  model: '~deepseek/deepseek-v4-flash-latest',
  system: 'Only profile facts',
  user: 'profile',
  schema: z.object({ answer: z.string() }),
  schemaName: 'answers',
  timeoutMs: 1000,
  reasoning: false,
}
afterEach(() => vi.unstubAllGlobals())
describe('OpenRouter latest Flash', () => {
  it('uses the latest alias and records the resolved model', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        model: 'deepseek/deepseek-v4-flash-0731',
        choices: [{ message: { content: '{"answer":"From my profile"}' } }],
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const result = await complete(options)
    expect(config().OPENROUTER_ANSWER_MODEL).toBe(options.model)
    const request = JSON.parse(
      (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as string,
    )
    expect(request).toMatchObject({
      model: options.model,
      reasoning: { enabled: false },
      response_format: { type: 'json_schema' },
    })
    expect(result.model).toBe('deepseek/deepseek-v4-flash-0731')
  })
  it.each([401, 402, 403])(
    'surfaces %i without a model fallback',
    async (status) => {
      const fetch = vi.fn(async () => new Response('{}', { status }))
      vi.stubGlobal('fetch', fetch)
      await expect(complete(options)).rejects.toMatchObject({
        isAuthError: true,
        status,
      })
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )
  it.each(['not json', '{"wrong":true}'])(
    'rejects malformed model output: %s',
    async (content) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json({ choices: [{ message: { content } }] }),
        ),
      )
      await expect(complete(options)).rejects.toBeInstanceOf(OpenRouterError)
    },
  )
  it('handles deadlines without trying another model', async () => {
    const fetch = vi.fn(async () => {
      throw new DOMException('Timed out', 'TimeoutError')
    })
    vi.stubGlobal('fetch', fetch)
    await expect(complete(options)).rejects.toThrow(/timed out/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
