import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Job } from '@/lib/jobs-types'
const identity = vi.hoisted(() => ({ id: 'alice' }))
vi.mock('@/lib/session', () => ({
  requireUser: async () => ({ id: identity.id }),
  currentUser: async () => ({ id: identity.id }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'jobo-product-'))
process.env.JOBO_API_KEY = 'jbe_test_fixture'
process.env.OPENROUTER_API_KEY = 'test-fixture'
process.env.PUBLIC_BASE_URL = 'https://demo.jobo.world'
process.env.RESUME_URL_SIGNING_SECRET =
  'test-signing-secret-that-is-long-enough'
process.env.API_KEY_ENCRYPTION_SECRET =
  'test-encryption-secret-that-is-long-enough'
process.env.JOBO_API_BASE_URL = 'https://connect.example.test'
process.env.JOBO_STATUS_URL = 'https://status.example.test/uptime'
let db: typeof import('@/db/client').db
let schema: typeof import('@/db/schema')
let queue: typeof import('@/lib/queue')
const job: Job = {
  slug: 'multi-step',
  company: 'Cascade',
  mark: 'CA',
  role: 'Data Engineer',
  location: 'Amsterdam',
  department: 'Data',
  employmentType: 'Full-time',
  about: 'Data pipelines',
  responsibilities: ['Build pipelines'],
  applyUrl: 'https://sandbox.jobo.world/apply/multi-step',
  available: true,
}
beforeAll(async () => {
  ;({ db } = await import('@/db/client'))
  schema = await import('@/db/schema')
  queue = await import('@/lib/queue')
  expect(await db.select().from(schema.profiles)).toHaveLength(0)
  for (const id of ['alice', 'bob'])
    await db.insert(schema.user)
      .values({
        id,
        name: id,
        email: `${id}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
  const { seedSampleProfiles } = await import('@/db/seed'),
    { RESUME_DIR } = await import('@/db/client')
  await seedSampleProfiles(db, RESUME_DIR)
  for (const row of await db.select().from(schema.profiles)) {
    await db.update(schema.profiles).set({ data: {
      ...row.data,
      links: { ...row.data.links, linkedin: 'https://www.linkedin.com/in/jobo-test-candidate' },
    } }).where(eq(schema.profiles.id, row.id))
  }
  await db.update(schema.profiles)
    .set({ userId: 'alice', reviewedAt: Date.now() })
    .where(eq(schema.profiles.id, 'sample-ada-lovelace'))
  await db.update(schema.profiles)
    .set({ userId: 'bob', reviewedAt: Date.now() })
    .where(eq(schema.profiles.id, 'sample-grace-hopper'))
})
describe('private profiles and durable applications', () => {
  it('rejects another user’s resume and non-sandbox URLs', async () => {
    await expect(
      queue.enqueueApplication('bob', 'sample-ada-lovelace', job),
    ).rejects.toThrow(/Review/)
    await expect(
      queue.enqueueApplication('alice', 'sample-ada-lovelace', {
        ...job,
        applyUrl: 'https://example.com/apply/multi-step',
      }),
    ).rejects.toThrow(/Invalid/)
  })
  it('requires confirmation before application creation', async () => {
    await db.update(schema.profiles)
      .set({ reviewedAt: null })
      .where(eq(schema.profiles.id, 'sample-ada-lovelace'))
    await expect(
      queue.enqueueApplication('alice', 'sample-ada-lovelace', job),
    ).rejects.toThrow(/Review/)
    await db.update(schema.profiles)
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
    await expect(queue.enqueueApplication('alice', original.id, job)).rejects.toThrow(/LinkedIn/)
    const noPhone = { ...original.data, personal: { ...original.data.personal, phone: null } }
    expect((await updateProfileAction(original.id, { data: noPhone, confirm: true })).error).toContain('phone')
    // Self-identification must be answered — "decline" counts, untouched does not.
    const unanswered = { ...original.data, eeo: { ...original.data.eeo, veteran: null } }
    expect((await updateProfileAction(original.id, { data: unanswered, confirm: true })).error).toContain('veteran')
    const noSponsorship = { ...original.data, work_authorization: { ...original.data.work_authorization, requires_sponsorship: null } }
    expect((await updateProfileAction(original.id, { data: noSponsorship, confirm: true })).error).toContain('sponsorship')
    const declined = { ...original.data, eeo: { ...original.data.eeo, veteran: 'decline' as const } }
    expect(await updateProfileAction(original.id, { data: declined, confirm: true })).toEqual({ ok: true })
  })
  it('deduplicates clicks and preserves the original profile and PDF', async () => {
    const id = await queue.enqueueApplication('alice', 'sample-ada-lovelace', job)
    expect(await queue.enqueueApplication('alice', 'sample-ada-lovelace', job)).toBe(
      id,
    )
    const [original] = await db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, 'sample-ada-lovelace'))
      .limit(1)
    await db.update(schema.profiles)
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
    expect(row.profileSnapshot?.data.personal.first_name).toBe(
      original.data.personal.first_name,
    )
    expect(row.profileSnapshot?.data.eeo.gender).toBe('female')
    const { RESUME_DIR } = await import('@/db/client')
    expect(readFileSync(join(RESUME_DIR, `${id}.pdf`))).toEqual(
      readFileSync(join(RESUME_DIR, `${original.id}.pdf`)),
    )
  })
  it('enforces global and per-user concurrency and recovers expired leases', async () => {
    const otherJob = {
      ...job,
      slug: 'all-field-types',
      applyUrl: 'https://sandbox.jobo.world/apply/all-field-types',
    }
    await queue.enqueueApplication('alice', 'sample-ada-lovelace', otherJob)
    await queue.enqueueApplication('bob', 'sample-grace-hopper', job)
    const now = Date.now(),
      a = (await queue.claimApplication('worker-a', 2, 1, now))!,
      b = (await queue.claimApplication('worker-b', 2, 1, now))!
    expect(a.userId).not.toBe(b.userId)
    expect(await queue.claimApplication('worker-c', 2, 1, now)).toBeNull()
    const recovered = (await queue.claimApplication(
      'worker-c',
      2,
      1,
      now + queue.LEASE_MS + 1,
    ))!
    expect(recovered.id).toBe(a.id)
    expect(await queue.renewLease(recovered.id, 'worker-a')).toBe(false)
    expect(await queue.renewLease(recovered.id, 'worker-c')).toBe(true)
    await queue.releaseLease(recovered.id, 'worker-c')
    await queue.releaseLease(b.id, 'worker-b')
  })
  it('never exceeds the caps when workers claim at the same moment', async () => {
    // SQLite serialised these for free. Here the advisory lock does, and
    // without it two claimers both pass the cap check on the same snapshot.
    const now = Date.now()
    const claims = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        queue.claimApplication(`racer-${i}`, 2, 1, now),
      ),
    )
    const won = claims.filter((c) => c !== null)
    expect(won).toHaveLength(2)
    expect(new Set(won.map((c) => c!.userId)).size).toBe(2)
    for (const [i, c] of claims.entries())
      if (c) await queue.releaseLease(c.id, `racer-${i}`)
  })
  it('creates one application when the same job is applied to twice at once', async () => {
    const racingJob = {
      ...job,
      slug: 'education-and-work-history',
      applyUrl: 'https://sandbox.jobo.world/apply/education-and-work-history',
    }
    const ids = await Promise.all(
      Array.from({ length: 5 }, () =>
        queue.enqueueApplication('alice', 'sample-ada-lovelace', racingJob),
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
    const id = await queue.enqueueApplication('alice', 'sample-ada-lovelace', job)
    await db.update(schema.applications)
      .set({ status: 'submitted' })
      .where(eq(schema.applications.id, id))
    expect(
      await queue.enqueueApplication('alice', 'sample-ada-lovelace', job, true),
    ).toBe(id)
    await db.update(schema.applications)
      .set({ status: 'failed', failureCode: 'submission_unconfirmed' })
      .where(eq(schema.applications.id, id))
    expect(
      await queue.enqueueApplication('alice', 'sample-ada-lovelace', job, true),
    ).toBe(id)
    await db.update(schema.applications)
      .set({ status: 'failed', failureCode: 'answers_timeout' })
      .where(eq(schema.applications.id, id))
    expect(
      await queue.enqueueApplication('alice', 'sample-ada-lovelace', job, true),
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
    expect(
      (await actions.setDefaultProfileAction('sample-grace-hopper')).ok,
    ).toBe(false)
    await actions.deleteProfileAction('sample-grace-hopper')
    expect(
      (
        await db
          .select()
          .from(schema.profiles)
          .where(eq(schema.profiles.id, 'sample-grace-hopper'))
      )[0]?.archived,
    ).toBe(false)
    const { GET } = await import('@/app/api/resumes/[profileId]/route')
    expect(
      (
        await GET(
          new Request(
            'https://demo.jobo.world/api/resumes/sample-grace-hopper',
          ),
          { params: Promise.resolve({ profileId: 'sample-grace-hopper' }) },
        )
      ).status,
    ).toBe(404)
    const [other] = await db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.userId, 'bob'))
      .limit(1)
    const { cancelApplicationAction } =
      await import('@/app/actions/applications')
    expect((await cancelApplicationAction(other.id)).ok).toBe(false)
    expect(
      (
        await db
          .select()
          .from(schema.applications)
          .where(eq(schema.applications.id, other.id))
      )[0]?.cancelRequested,
    ).toBe(false)
  })
  it('applies to real jobs only in production mode, on the visitor’s sealed key', async () => {
    const realId = '9d1c2b3a-4e5f-4a6b-8c7d-0e1f2a3b4c5d'
    const visitorKey = 'jbe_live_abcdefghijklmnopqrstu_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG'
    const seen: { url: string; key: string | null }[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      seen.push({ url, key: new Headers(init?.headers).get('x-api-key') })
      if (url.startsWith('https://status.example.test'))
        return Response.json({ auto_apply_providers: [{ provider_id: 'lever', display_name: 'Lever' }] })
      if (url === `https://connect.example.test/api/jobs/${realId}`)
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
      const { startApplicationAction } = await import('@/app/actions/applications')
      const refused = await startApplicationAction({ jobId: realId, profileId: 'sample-ada-lovelace' })
      expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/production mode/) })
      expect(seen).toHaveLength(0)

      const { connectApiKey } = await import('@/lib/user-settings')
      await connectApiKey('alice', visitorKey)
      const started = await startApplicationAction({ jobId: realId, profileId: 'sample-ada-lovelace' })
      expect(started.ok).toBe(true)
      expect(seen.find((c) => c.url.includes(realId))?.key).toBe(visitorKey)
      const [row] = await db
        .select()
        .from(schema.applications)
        .where(eq(schema.applications.id, (started as { id: string }).id))
      expect(row).toMatchObject({
        jobId: realId,
        sandbox: false,
        scenarioSlug: null,
        applyUrl: 'https://jobs.lever.co/globex/1/apply',
      })
      expect(row.apiKeyCiphertext).toBeTruthy()
      expect(row.apiKeyCiphertext).not.toContain(visitorKey)
      expect(row.jobSnapshot?.countryCode).toBe('CA')

      // Back in sandbox, the same real job is refused again.
      const { setDemoMode } = await import('@/lib/user-settings')
      await setDemoMode('alice', 'sandbox')
      expect(
        (await startApplicationAction({ jobId: realId, profileId: 'sample-ada-lovelace', retry: true })).ok,
      ).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('never queues a production job without a key, or a sandbox job with one', async () => {
    const realJob: Job = {
      ...job,
      slug: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
      applyUrl: 'https://jobs.lever.co/globex/2',
      production: true,
    }
    await expect(
      queue.enqueueApplication('alice', 'sample-ada-lovelace', realJob),
    ).rejects.toThrow(/API key/)
    await expect(
      queue.enqueueApplication('alice', 'sample-ada-lovelace', job, false, { apiKeyCiphertext: 'x' }),
    ).rejects.toThrow(/Invalid sandbox job/)
  })
  it('archives profiles without deleting application history', async () => {
    const { deleteProfileAction } = await import('@/app/actions/profiles')
    const count = (await db.select().from(schema.applications)).length
    await deleteProfileAction('sample-ada-lovelace')
    expect(
      (
        await db
          .select()
          .from(schema.profiles)
          .where(eq(schema.profiles.id, 'sample-ada-lovelace'))
      )[0]?.archived,
    ).toBe(true)
    expect(await db.select().from(schema.applications)).toHaveLength(count)
  })
})
