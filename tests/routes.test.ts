import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SAMPLE_PROFILES } from '@/tests/support/seed'
import { sandboxJob, sealedKey } from '@/tests/support/jobs'

/**
 * The API key actions, the live-status endpoint and the resume upload route:
 * the HTTP surfaces a visitor can call directly, so each must validate its
 * input and refuse anything that is not the caller's.
 */

const identity = vi.hoisted(() => ({ id: 'alice' as string | null }))
const mocked = vi.hoisted(() => ({
  verifyApiKey: vi.fn(),
  structureResume: vi.fn(),
}))
vi.mock('@/lib/session', () => ({
  requireUser: async () => {
    if (!identity.id) throw new Error('redirect /login')
    return { id: identity.id }
  },
  currentUser: async () => (identity.id ? { id: identity.id } : null),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/jobo/jobs-api', async (original) => ({
  ...(await original<typeof import('@/lib/jobo/jobs-api')>()),
  verifyApiKey: mocked.verifyApiKey,
}))
vi.mock('@/lib/resume/structure', async (original) => ({
  ...(await original<typeof import('@/lib/resume/structure')>()),
  structureResume: mocked.structureResume,
}))

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'jobo-routes-'))
process.env.OPENROUTER_API_KEY = 'fixture'
process.env.RESUME_URL_SIGNING_SECRET = 'fixture-signing-secret-with-32-characters'
process.env.API_KEY_ENCRYPTION_SECRET = 'fixture-encryption-secret-with-32-characters'
process.env.BETTER_AUTH_URL = 'http://localhost:3000'
process.env.BETTER_AUTH_SECRET = 'fixture-auth-secret-with-at-least-32-characters'
process.env.BREVO_API_KEY = 'fixture'
process.env.AUTH_EMAIL_FROM = 'noreply@example.com'

const VISITOR_KEY = 'jbe_live_abcdefghijklmnopqrstu_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG'

let db: typeof import('@/db/client').db
let schema: typeof import('@/db/schema')
let keys: typeof import('@/app/actions/api-key')

beforeAll(async () => {
  ;({ db } = await import('@/db/client'))
  schema = await import('@/db/schema')
  keys = await import('@/app/actions/api-key')
  const { seedSampleProfiles } = await import('@/tests/support/seed')
  const { RESUME_DIR } = await import('@/db/client')
  await seedSampleProfiles(db, RESUME_DIR, 'alice')
  await seedSampleProfiles(db, RESUME_DIR, 'bob')
})

beforeEach(() => {
  identity.id = 'alice'
  vi.clearAllMocks()
})

describe('API key actions', () => {
  const SANDBOX_KEY = 'jbe_test_abcdefghijklmnopqrstu_0123456789'
  const settingsOf = async (userId: string) =>
    (await import('@/lib/user-settings')).getKeySettings(userId)

  it('rejects malformed input without calling Jobo', async () => {
    expect(
      await keys.connectApiKeyAction({ apiKey: 42, acknowledged: true } as never),
    ).toMatchObject({ ok: false })
    expect(await keys.connectApiKeyAction({ apiKey: '   ', acknowledged: true })).toMatchObject({
      ok: false,
    })
    expect(mocked.verifyApiKey).not.toHaveBeenCalled()
  })

  it('connects a sandbox key with no real-employers warning: the environment is sandbox', async () => {
    identity.id = 'bob'
    expect(await settingsOf('bob')).toMatchObject({ mode: null })
    mocked.verifyApiKey.mockResolvedValue({ ok: true })
    expect(await keys.connectApiKeyAction({ apiKey: SANDBOX_KEY, acknowledged: false })).toEqual({
      ok: true,
    })
    expect(mocked.verifyApiKey).toHaveBeenCalledWith(SANDBOX_KEY)
    expect(await settingsOf('bob')).toEqual({
      mode: 'sandbox',
      keyHint: SANDBOX_KEY.slice(-4),
      acknowledged: false,
    })
  })

  it('requires the real-employers acknowledgement for a production key the first time', async () => {
    expect(
      await keys.connectApiKeyAction({ apiKey: VISITOR_KEY, acknowledged: false }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/real employers/) })
    expect(mocked.verifyApiKey).not.toHaveBeenCalled()
  })

  it('does not store a key Jobo refuses', async () => {
    identity.id = 'carol'
    mocked.verifyApiKey.mockResolvedValue({ ok: false, error: 'Jobo rejected this API key.' })
    expect(await keys.connectApiKeyAction({ apiKey: SANDBOX_KEY, acknowledged: false })).toEqual({
      ok: false,
      error: 'Jobo rejected this API key.',
    })
    expect(await settingsOf('carol')).toMatchObject({ mode: null })
  })

  it('stores a verified production key sealed, derives production from it, and forgets it', async () => {
    mocked.verifyApiKey.mockResolvedValue({ ok: true })
    expect(
      await keys.connectApiKeyAction({ apiKey: ` ${VISITOR_KEY} `, acknowledged: true }),
    ).toEqual({ ok: true })
    expect(mocked.verifyApiKey).toHaveBeenCalledWith(VISITOR_KEY)
    const [stored] = await db
      .select()
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, 'alice'))
    expect(stored.apiKeyCiphertext).toBeTruthy()
    expect(stored.apiKeyCiphertext).not.toContain(VISITOR_KEY)
    expect(await settingsOf('alice')).toEqual({
      mode: 'production',
      keyHint: VISITOR_KEY.slice(-4),
      acknowledged: true,
    })

    // Replacing it with a sandbox key is how a visitor switches back.
    expect(await keys.connectApiKeyAction({ apiKey: SANDBOX_KEY, acknowledged: false })).toEqual({
      ok: true,
    })
    expect(await settingsOf('alice')).toMatchObject({ mode: 'sandbox', acknowledged: true })

    expect(await keys.forgetApiKeyAction()).toEqual({ ok: true })
    expect(await settingsOf('alice')).toMatchObject({ mode: null, keyHint: null })
  })
})

describe('GET /api/applications/[id]/live', () => {
  it('reports the state of the caller’s own application and 404s for anyone else', async () => {
    const { enqueueApplication } = await import('@/lib/queue')
    await db
      .update(schema.profiles)
      .set({ reviewedAt: Date.now(), data: readyProfile() })
      .where(eq(schema.profiles.id, 'sample-ada-lovelace'))
    const id = await enqueueApplication('alice', 'sample-ada-lovelace', sandboxJob(), sealedKey())
    const { GET } = await import('@/app/api/applications/[id]/live/route')
    const params = { params: Promise.resolve({ id }) }

    const own = await GET(new Request('http://localhost/x'), params)
    expect(own.status).toBe(200)
    expect(await own.json()).toMatchObject({ status: 'queued', active: true })

    identity.id = 'bob'
    expect((await GET(new Request('http://localhost/x'), params)).status).toBe(404)
    identity.id = null
    expect((await GET(new Request('http://localhost/x'), params)).status).toBe(401)
  })
})

describe('POST /api/profiles/import', () => {
  const pdf = readFileSync(join(__dirname, 'fixtures', 'ada-lovelace.pdf'))
  const upload = (
    origin: string | null,
    file: Blob = new Blob([pdf], { type: 'application/pdf' }),
  ) => {
    const body = new FormData()
    body.append('resume', file, 'resume.pdf')
    return new Request('http://localhost:3000/api/profiles/import', {
      method: 'POST',
      body,
      headers: origin ? { origin } : {},
    })
  }

  it('only accepts uploads posted from this app', async () => {
    const { POST } = await import('@/app/api/profiles/import/route')
    expect((await POST(upload('https://evil.example.com'))).status).toBe(403)
    expect((await POST(upload(null))).status).toBe(403)
    expect(mocked.structureResume).not.toHaveBeenCalled()
  })

  it('refuses files over the size limit', async () => {
    const { POST } = await import('@/app/api/profiles/import/route')
    const big = new Blob([new Uint8Array(6 * 1024 * 1024)], { type: 'application/pdf' })
    expect((await POST(upload('http://localhost:3000', big))).status).toBe(413)
  })

  it('creates a profile owned by the caller, then rate-limits', async () => {
    identity.id = 'bob'
    mocked.structureResume.mockResolvedValue(readyProfile())
    const { POST } = await import('@/app/api/profiles/import/route')
    const created = await POST(upload('http://localhost:3000'))
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: string }
    const [row] = await db.select().from(schema.profiles).where(eq(schema.profiles.id, id))
    expect(row.userId).toBe('bob')

    // Bob now has his seeded samples plus this upload; fill the hourly allowance.
    const recent = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, 'bob'))
    for (let i = recent.length; i < 10; i++)
      expect((await POST(upload('http://localhost:3000'))).status).toBe(201)
    expect((await POST(upload('http://localhost:3000'))).status).toBe(429)
  })
})

function readyProfile() {
  const data = structuredClone(SAMPLE_PROFILES[0].data)
  data.links.linkedin = 'https://www.linkedin.com/in/jobo-test-candidate'
  return data
}
