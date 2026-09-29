import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@jobo-ai/autoapply'
import { jsonBody, previewJson } from '@/lib/jobo/api-preview'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'jobo-api-preview-'))
let db: typeof import('@/db/client').db
let schema: typeof import('@/db/schema')
let recordingFetch: typeof import('@/lib/jobo/recording-fetch').recordingFetch
beforeAll(async () => {
  ;({ db } = await import('@/db/client'))
  schema = await import('@/db/schema')
  ;({ recordingFetch } = await import('@/lib/jobo/recording-fetch'))
  const { seedSampleProfiles } = await import('@/db/seed')
  const { RESUME_DIR } = await import('@/db/client')
  seedSampleProfiles(db, RESUME_DIR)
  db.insert(schema.applications).values({
    id: 'captured', idempotencyKey: 'trace-idempotency', profileId: 'sample-ada-lovelace',
    applyUrl: 'https://sandbox.jobo.world/apply/multi-step', status: 'queued',
  }).run()
})
beforeEach(() => db.delete(schema.apiExchanges).run())
const rows = () => db.select().from(schema.apiExchanges).all()

describe('redacted API previews', () => {
  it('redacts nested credentials, known secret echoes, bearer values, and signed URLs without changing answers', () => {
    const value = {
      nested: [{ authorization: 'Bearer private', api_key: 'key', access_token: 'token' }],
      answer: 'Ada Lovelace', note: 'echo private-known-secret',
      resume: 'https://demo.jobo.world/api/resumes/123?exp=123&token=resume-signature',
      text: 'Bearer some-private-token', other: 'jbe_live_unknownsecret',
    }
    const text = previewJson(value, ['private-known-secret'])
    for (const secret of ['Bearer private', '"key"', 'resume-signature', 'private-known-secret', 'some-private-token', 'jbe_live_unknownsecret']) expect(text).not.toContain(secret)
    expect(text).toContain('Ada Lovelace')
    expect(text).toContain('REDACTED')
    expect(value.resume).toContain('resume-signature')
  })

  it('omits non-JSON bodies and labels oversized captures', () => {
    expect(jsonBody('<html>secret</html>')).toEqual({ notice: 'Non-JSON body omitted from preview.' })
    expect(JSON.parse(previewJson({ data: 'x'.repeat(70000) })).notice).toMatch(/truncated/)
  })

  it('records an actual request and response but preserves transport headers, bodies and readable response', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: 'submitted', echo: 'private-known-secret' }, {
      status: 201, headers: { 'set-cookie': 'private-cookie', 'x-request-id': 'request-1' },
    }))
    const request = JSON.stringify({ answers: [{ field_id: 'resume', value: { url: 'https://demo.jobo.world/api/application-resumes/123?token=download-secret' } }] })
    const options = { method: 'POST', headers: { 'X-Api-Key': 'private-known-secret', Cookie: 'private-cookie', 'content-type': 'application/json' }, body: request }
    const response = await recordingFetch('captured', ['private-known-secret'], transport)('https://connect.jobo.world/api/auto-apply/applications/1/answers', options)
    expect(transport).toHaveBeenCalledWith('https://connect.jobo.world/api/auto-apply/applications/1/answers', options)
    expect(await response.json()).toEqual({ status: 'submitted', echo: 'private-known-secret' })
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toMatchObject({ applicationId: 'captured', method: 'POST', statusCode: 201, error: null })
    expect(rows()[0].elapsedMs).toBeGreaterThanOrEqual(0)
    const stored = JSON.stringify(rows())
    for (const secret of ['private-known-secret', 'private-cookie', 'download-secret', 'X-Api-Key']) expect(stored).not.toContain(secret)
  })

  it('captures error responses and separate SDK retry attempts with the same idempotency key', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ code: 'temporarily_unavailable' }, { status: 503, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(Response.json({ id: 'upstream', status: 'submitted' }))
    const sdk = createClient({ apiKey: 'jbe_test_hidden', fetch: recordingFetch('captured', ['jbe_test_hidden'], transport), maxRetries: 1 })
    await sdk.applications.create({ apply_url: 'https://sandbox.jobo.world/apply/multi-step' }, { idempotencyKey: 'same-request' })
    expect(rows().map(row => row.statusCode)).toEqual([503, 200])
    expect(rows().every(row => JSON.parse(row.requestJson).headers['idempotency-key'] === 'same-request')).toBe(true)
    expect(rows()[0].responseJson).toContain('temporarily_unavailable')
  })

  it('records a network failure without leaking its error text or pretending an HTTP response arrived', async () => {
    const error = new Error('secret-in-error')
    const transport = vi.fn<typeof fetch>().mockRejectedValue(error)
    await expect(recordingFetch('captured', [], transport)('https://connect.jobo.world/api/auto-apply/applications')).rejects.toBe(error)
    expect(rows()[0]).toMatchObject({ statusCode: null, responseJson: null })
    expect(rows()[0].error).toContain('No HTTP response received')
    expect(JSON.stringify(rows())).not.toContain('secret-in-error')
  })
  it('bounds audit growth without stopping subsequent API calls', async () => {
    db.insert(schema.apiExchanges).values(Array.from({ length: 100 }, (_, i) => ({
      id: `limit-${i}`, applicationId: 'captured', method: 'GET',
      url: 'https://connect.jobo.world/api/auto-apply/applications/1',
      requestJson: '{}', startedAt: i,
    }))).run()
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: 'submitted' }))
    const response = await recordingFetch('captured', [], transport)('https://connect.jobo.world/api/auto-apply/applications/1')
    expect(await response.json()).toEqual({ status: 'submitted' })
    expect(rows()).toHaveLength(100)
  })

  it('does not turn a capture storage failure into a failed API request', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: 'submitted' }))
      const response = await recordingFetch('missing-application', [], transport)('https://connect.jobo.world/api/auto-apply/applications')
      expect(response.ok).toBe(true)
      expect(transport).toHaveBeenCalledTimes(1)
      expect(rows()).toHaveLength(0)
    } finally { warning.mockRestore() }
  })

})
