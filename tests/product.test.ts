import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Job } from '@/lib/jobs-types'
import { LIVE_KEY, SANDBOX_KEY, sandboxJob, sealedKey } from '@/tests/support/jobs'
const identity = vi.hoisted(() => ({ id: 'alice' }))
vi.mock('@/lib/session', () => ({
  requireUser: async () => ({ id: identity.id }),
  currentUser: async () => ({ id: identity.id }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'jobo-product-'))
process.env.OPENROUTER_API_KEY = 'test-fixture'
process.env.PUBLIC_BASE_URL = 'https://demo.jobo.world'
process.env.RESUME_URL_SIGNING_SECRET = 'test-signing-secret-that-is-long-enough'
process.env.API_KEY_ENCRYPTION_SECRET = 'test-encryption-secret-that-is-long-enough'
process.env.JOBO_API_BASE_URL = 'https://connect.example.test'
process.env.JOBO_STATUS_URL = 'https://status.example.test/uptime'
let db: typeof import('@/db/client').db
let schema: typeof import('@/db/schema')
let queue: typeof import('@/lib/queue')
const job: Job = sandboxJob()
beforeAll(async () => {
  ;({ db } = await import('@/db/client'))
  schema = await import('@/db/schema')
  queue = await import('@/lib/queue')
  expect(await db.select().from(schema.profiles)).toHaveLength(0)
  for (const id of ['alice', 'bob'])
    await db.insert(schema.user).values({
      id,
      name: id,
      email: `${id}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  const { seedSampleProfiles } = await import('@/tests/support/seed'),
    { RESUME_DIR } = await import('@/db/client')
  await seedSampleProfiles(db, RESUME_DIR)
  for (const row of await db.select().from(schema.profiles)) {
    await db
      .update(schema.profiles)
      .set({
        data: {
          ...row.data,
          links: { ...row.data.links, linkedin: 'https://www.linkedin.com/in/jobo-test-candidate' },
        },
      })
      .where(eq(schema.profiles.id, row.id))
  }
  await db
    .update(schema.profiles)
    .set({ userId: 'alice', reviewedAt: Date.now() })
    .where(eq(schema.profiles.id, 'sample-ada-lovelace'))
  await db
    .update(schema.profiles)
    .set({ userId: 'bob', reviewedAt: Date.now() })
    .where(eq(schema.profiles.id, 'sample-grace-hopper'))
})
describe('private profiles and durable applications', () => {
  it('rejects another user’s resume and real jobs in sandbox mode', async () => {
    await expect(
      queue.enqueueApplication('bob', 'sample-ada-lovelace', job, sealedKey()),
    ).rejects.toThrow(/Review/)
    await expect(
      queue.enqueueApplication(
        'alice',
        'sample-ada-lovelace',
        { ...job, source: 'lever' },
        sealedKey(),
      ),
    ).rejects.toThrow(/does not support/)
  })
  it('requires confirmation before application creation', async () => {
    await db
      .update(schema.profiles)
      .set({ reviewedAt: null })
      .where(eq(schema.profiles.id, 'sample-ada-lovelace'))
    await expect(
      queue.enqueueApplication('alice', 'sample-ada-lovelace', job, sealedKey()),
    ).rejects.toThrow(/Review/)
    await db
      .update(schema.profiles)
      .set({ reviewedAt: Date.now() })
      .where(eq(schema.profiles.id, 'sample-ada-lovelace'))
  })
  it('saves incomplete drafts but requires LinkedIn, phone and employment answers for confirmation and enqueue', async () => {
    const { updateProfileAction } = await import('@/app/actions/profiles')
    const where = eq(schema.profiles.id, 'sample-ada-lovelace')
    const [original] = await db.select().from(schema.profiles).where(where).limit(1)
    const draft = { ...original.data, links: { ...original.data.links, linkedin: null } }
    await db.update(schema.profiles).set({ reviewedAt: null }).where(where)
    expect(await updateProfileAction(original.id, { data: draft })).toEqual({ ok: true })
    expect((await db.select().from(schema.profiles).where(where))[0]?.reviewedAt).toBeNull()
    expect((await updateProfileAction(original.id, { confirm: true })).error).toContain('LinkedIn')
    // A stale reviewed timestamp must not bypass current requirements.
    await db.update(schema.profiles).set({ reviewedAt: 1 }).where(where)
    await expect(queue.enqueueApplication('alice', original.id, job, sealedKey())).rejects.toThrow(
      /LinkedIn/,
    )
    const noPhone = { ...original.data, personal: { ...original.data.personal, phone: null } }
    expect(
      (await updateProfileAction(original.id, { data: noPhone, confirm: true })).error,
    ).toContain('phone')
    // Self-identification must be answered — "decline" counts, untouched does not.
    const unanswered = { ...original.data, eeo: { ...original.data.eeo, veteran: null } }
    expect(
      (await updateProfileAction(original.id, { data: unanswered, confirm: true })).error,
    ).toContain('veteran')
    const noSponsorship = {
      ...original.data,
      work_authorization: { ...original.data.work_authorization, requires_sponsorship: null },
    }
    expect(
      (await updateProfileAction(original.id, { data: noSponsorship, confirm: true })).error,
    ).toContain('sponsorship')
    const declined = {
      ...original.data,
      eeo: { ...original.data.eeo, veteran: 'decline' as const },
    }
    expect(await updateProfileAction(original.id, { data: declined, confirm: true })).toEqual({
      ok: true,
    })
  })
  it('deduplicates clicks and preserves the original profile and PDF', async () => {
    const id = await queue.enqueueApplication('alice', 'sample-ada-lovelace', job, sealedKey())
    expect(await queue.enqueueApplication('alice', 'sample-ada-lovelace', job, sealedKey())).toBe(
      id,
    )
    const [original] = await db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, 'sample-ada-lovelace'))
      .limit(1)
    await db
      .update(schema.profiles)
      .set({
        data: {
          ...original.data,
          eeo: { ...original.data.eeo, gender: 'decline' },
          personal: { ...original.data.personal, first_name: 'Edited' },
        },
      })
      .where(eq(schema.profiles.id, original.id))
    const [row] = await db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.id, id))
      .limit(1)
    expect(row.profileSnapshot?.data.personal.first_name).toBe(original.data.personal.first_name)
    expect(row.profileSnapshot?.data.eeo.gender).toBe('female')
    const { RESUME_DIR } = await import('@/db/client')
    expect(readFileSync(join(RESUME_DIR, `${id}.pdf`))).toEqual(
      readFileSync(join(RESUME_DIR, `${original.id}.pdf`)),
    )
  })
  it('enforces global and per-user concurrency and recovers expired leases', async () => {
    const otherJob = sandboxJob(2)
    await queue.enqueueApplication('alice', 'sample-ada-lovelace', otherJob, sealedKey())
    await queue.enqueueApplication('bob', 'sample-grace-hopper', job, sealedKey())
    const now = Date.now(),
      a = (await queue.claimApplication('worker-a', 2, 1, now))!,
      b = (await queue.claimApplication('worker-b', 2, 1, now))!
    expect(a.userId).not.toBe(b.userId)
    expect(await queue.claimApplication('worker-c', 2, 1, now)).toBeNull()
    const recovered = (await queue.claimApplication('worker-c', 2, 1, now + queue.LEASE_MS + 1))!
    expect(recovered.id).toBe(a.id)
    expect(await queue.renewLease(recovered.id, 'worker-a')).toBe(false)
    expect(await queue.renewLease(recovered.id, 'worker-c')).toBe(true)
    await queue.releaseLease(recovered.id, 'worker-c')
    await queue.releaseLease(b.id, 'worker-b')
  })
  it('never exceeds the caps when workers claim at the same moment', async () => {
    // The claim's advisory lock serialises these. Without it, two claimers
    // both pass the cap check on the same snapshot.
    const now = Date.now()
    const claims = await Promise.all(
      Array.from({ length: 8 }, (_, i) => queue.claimApplication(`racer-${i}`, 2, 1, now)),
    )
    const won = claims.filter((c) => c !== null)
    expect(won).toHaveLength(2)
    expect(new Set(won.map((c) => c!.userId)).size).toBe(2)
    for (const [i, c] of claims.entries()) if (c) await queue.releaseLease(c.id, `racer-${i}`)
  })
  it('creates one application when the same job is applied to twice at once', async () => {
    const racingJob = sandboxJob(3)
    const ids = await Promise.all(
      Array.from({ length: 5 }, () =>
        queue.enqueueApplication('alice', 'sample-ada-lovelace', racingJob, sealedKey()),
      ),
    )
    expect(new Set(ids).size).toBe(1)
    const rows = await db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.jobId, racingJob.slug))
    expect(rows).toHaveLength(1)
  })
  it('does not retry ambiguous or confirmed submitted applications', async () => {
    const id = await queue.enqueueApplication('alice', 'sample-ada-lovelace', job, sealedKey())
    await db
      .update(schema.applications)
      .set({ status: 'submitted' })
      .where(eq(schema.applications.id, id))
    expect(
      await queue.enqueueApplication('alice', 'sample-ada-lovelace', job, sealedKey(), true),
    ).toBe(id)
    await db
      .update(schema.applications)
      .set({ status: 'failed', failureCode: 'submission_unconfirmed' })
      .where(eq(schema.applications.id, id))
    expect(
      await queue.enqueueApplication('alice', 'sample-ada-lovelace', job, sealedKey(), true),
    ).toBe(id)
    await db
      .update(schema.applications)
      .set({ status: 'failed', failureCode: 'answers_timeout' })
      .where(eq(schema.applications.id, id))
    expect(
      await queue.enqueueApplication('alice', 'sample-ada-lovelace', job, sealedKey(), true),
    ).not.toBe(id)
  })
  it('rejects cross-user edits, deletion, default selection, downloads, and cancellation', async () => {
    const actions = await import('@/app/actions/profiles')
    expect(
      (
        await actions.updateProfileAction('sample-grace-hopper', {
          name: 'Stolen',
        })
      ).ok,
    ).toBe(false)
    expect((await actions.setDefaultProfileAction('sample-grace-hopper')).ok).toBe(false)
    await actions.deleteProfileAction('sample-grace-hopper')
    expect(
      (
        await db.select().from(schema.profiles).where(eq(schema.profiles.id, 'sample-grace-hopper'))
      )[0]?.archived,
    ).toBe(false)
    const { GET } = await import('@/app/api/resumes/[profileId]/route')
    expect(
      (
        await GET(new Request('https://demo.jobo.world/api/resumes/sample-grace-hopper'), {
          params: Promise.resolve({ profileId: 'sample-grace-hopper' }),
        })
      ).status,
    ).toBe(404)
    const [other] = await db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.userId, 'bob'))
      .limit(1)
    const { cancelApplicationAction } = await import('@/app/actions/applications')
    expect((await cancelApplicationAction(other.id)).ok).toBe(false)
    expect(
      (await db.select().from(schema.applications).where(eq(schema.applications.id, other.id)))[0]
        ?.cancelRequested,
    ).toBe(false)
  })
  it('asks once for the AI-answers acknowledgement before the first application', async () => {
    const fetchSpy = vi.fn(async () => new Response('not found', { status: 404 }))
    vi.stubGlobal('fetch', fetchSpy)
    try {
      identity.id = 'alice'
      const { connectApiKey } = await import('@/lib/user-settings')
      const { startApplicationAction } = await import('@/app/actions/applications')
      const { AI_CONSENT_VERSION } = await import('@/lib/ai-consent')
      await connectApiKey('alice', SANDBOX_KEY, false)
      const apply = (aiConsent?: true) =>
        startApplicationAction({
          jobId: 'missing-job',
          profileId: 'sample-ada-lovelace',
          aiConsent,
        })
      const stored = async () =>
        (
          await db.select().from(schema.userSettings).where(eq(schema.userSettings.userId, 'alice'))
        )[0]

      // Refused before anything is fetched or queued.
      expect(await apply()).toEqual({
        ok: false,
        error: expect.stringMatching(/AI-generated answers/),
        aiConsentRequired: true,
      })
      expect(fetchSpy).not.toHaveBeenCalled()

      // Ticking the box records it; the request then carries on (to a missing job here).
      expect(await apply(true)).not.toHaveProperty('aiConsentRequired')
      expect(await stored()).toMatchObject({ aiAnswersConsentVersion: AI_CONSENT_VERSION })
      expect((await stored()).aiAnswersConsentAt).toBeGreaterThan(0)

      // Not asked again.
      expect(await apply()).not.toHaveProperty('aiConsentRequired')

      // New wording asks again.
      await db
        .update(schema.userSettings)
        .set({ aiAnswersConsentVersion: 'older-wording' })
        .where(eq(schema.userSettings.userId, 'alice'))
      expect(await apply()).toMatchObject({ ok: false, aiConsentRequired: true })
      await apply(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('applies only once a key is connected, and to real jobs only on a production key', async () => {
    const realId = '9d1c2b3a-4e5f-4a6b-8c7d-0e1f2a3b4c5d'
    const seen: { url: string; key: string | null }[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const key = new Headers(init?.headers).get('x-api-key')
      seen.push({ url, key })
      if (url.startsWith('https://status.example.test'))
        return Response.json({
          auto_apply_providers: [{ provider_id: 'lever', display_name: 'Lever' }],
        })
      // Only a live key sees live jobs; a sandbox key gets a 404.
      if (url === `https://connect.example.test/api/jobs/${realId}` && key === LIVE_KEY)
        return Response.json({
          id: realId,
          title: 'Platform Engineer',
          company: { name: 'Globex' },
          apply_url: 'https://jobs.lever.co/globex/1/apply',
          locations: [{ location: 'Toronto, ON, Canada', country: 'CA' }],
          source: 'lever',
        })
      return new Response('not found', { status: 404 })
    })
    try {
      identity.id = 'alice'
      const { connectApiKey, forgetApiKey } = await import('@/lib/user-settings')
      const { startApplicationAction } = await import('@/app/actions/applications')
      const apply = (retry = false) =>
        startApplicationAction({ jobId: realId, profileId: 'sample-ada-lovelace', retry })

      // No key, no deployment key to fall back on: nothing is called.
      await forgetApiKey('alice')
      expect(await apply()).toMatchObject({ ok: false, error: expect.stringMatching(/API key/) })
      expect(seen).toHaveLength(0)

      // A sandbox key does not see real jobs.
      await connectApiKey('alice', SANDBOX_KEY, false)
      expect(await apply()).toMatchObject({
        ok: false,
        error: expect.stringMatching(/production key/),
      })
      expect(seen.map((c) => c.key)).toEqual([SANDBOX_KEY])

      await connectApiKey('alice', LIVE_KEY, true)
      const started = await apply()
      expect(started.ok).toBe(true)
      expect(seen).toContainEqual({
        url: `https://connect.example.test/api/jobs/${realId}`,
        key: LIVE_KEY,
      })
      const [row] = await db
        .select()
        .from(schema.applications)
        .where(eq(schema.applications.id, (started as { id: string }).id))
      expect(row).toMatchObject({
        jobId: realId,
        sandbox: false,
        applyUrl: 'https://jobs.lever.co/globex/1/apply',
      })
      expect(row.apiKeyCiphertext).toBeTruthy()
      expect(row.apiKeyCiphertext).not.toContain(LIVE_KEY)
      expect(row.jobSnapshot?.countryCode).toBe('CA')

      // Back on a sandbox key, the same real job is refused again.
      await connectApiKey('alice', SANDBOX_KEY, false)
      expect((await apply(true)).ok).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('applies to sandbox jobs on the visitor’s sandbox key, sealed on the row', async () => {
    const sandboxId = sandboxJob(5).slug
    const realId = sandboxJob(6).slug
    const keys: (string | null)[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      keys.push(new Headers(init?.headers).get('x-api-key'))
      if (url === `https://connect.example.test/api/jobs/${sandboxId}`)
        return Response.json({
          id: sandboxId,
          title: 'Data Engineer',
          company: { name: 'Cascade' },
          apply_url: 'https://sandbox.jobo.world/apply/cascade-data-engineer',
          locations: [{ location: 'Leeds, UK', country: 'GB' }],
          source: 'jobosandbox',
        })
      // A real job the sandbox should never return: refused all the same.
      if (url === `https://connect.example.test/api/jobs/${realId}`)
        return Response.json({
          id: realId,
          title: 'Platform Engineer',
          company: { name: 'Globex' },
          apply_url: 'https://jobs.lever.co/globex/1/apply',
          source: 'lever',
        })
      return new Response('not found', { status: 404 })
    })
    try {
      identity.id = 'alice'
      const { connectApiKey } = await import('@/lib/user-settings')
      await connectApiKey('alice', SANDBOX_KEY, false)
      const { startApplicationAction } = await import('@/app/actions/applications')
      const started = await startApplicationAction({
        jobId: sandboxId,
        profileId: 'sample-ada-lovelace',
      })
      expect(started.ok).toBe(true)
      expect(keys).toEqual([SANDBOX_KEY])
      const [row] = await db
        .select()
        .from(schema.applications)
        .where(eq(schema.applications.id, (started as { id: string }).id))
      expect(row).toMatchObject({
        jobId: sandboxId,
        sandbox: true,
        applyUrl: 'https://sandbox.jobo.world/apply/cascade-data-engineer',
      })
      expect(row.apiKeyCiphertext).toBeTruthy()
      expect(row.apiKeyCiphertext).not.toContain(SANDBOX_KEY)
      expect(row.jobSnapshot).toMatchObject({ source: 'jobosandbox', countryCode: 'GB' })

      expect(
        await startApplicationAction({ jobId: realId, profileId: 'sample-ada-lovelace' }),
      ).toMatchObject({ ok: false, error: expect.stringMatching(/does not support/) })
      expect(
        await db.select().from(schema.applications).where(eq(schema.applications.jobId, realId)),
      ).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('never queues a real job on a sandbox key, or a sandbox job on a production key', async () => {
    const realJob = sandboxJob(4, { applyUrl: 'https://jobs.lever.co/globex/2', source: 'lever' })
    await expect(
      queue.enqueueApplication('alice', 'sample-ada-lovelace', realJob, sealedKey()),
    ).rejects.toThrow(/does not support/)
    await expect(
      queue.enqueueApplication('alice', 'sample-ada-lovelace', job, sealedKey(LIVE_KEY)),
    ).rejects.toThrow(/does not support/)
  })
  it('archives profiles without deleting application history', async () => {
    const { deleteProfileAction } = await import('@/app/actions/profiles')
    const count = (await db.select().from(schema.applications)).length
    await deleteProfileAction('sample-ada-lovelace')
    expect(
      (
        await db.select().from(schema.profiles).where(eq(schema.profiles.id, 'sample-ada-lovelace'))
      )[0]?.archived,
    ).toBe(true)
    expect(await db.select().from(schema.applications)).toHaveLength(count)
  })
})
