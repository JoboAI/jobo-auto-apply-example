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
      links: [...row.data.links, { label: 'LinkedIn', type: 'linkedin', url: 'https://www.linkedin.com/in/jobo-test-candidate' }],
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
  it('saves incomplete drafts but requires LinkedIn and phone for confirmation and enqueue', async () => {
    const { updateProfileAction } = await import('@/app/actions/profiles')
    const where = eq(schema.profiles.id, 'sample-ada-lovelace')
    const [original] = await db.select().from(schema.profiles).where(where).limit(1)
    const draft = { ...original.data, links: [], self_identification: 'leave_blank' as const }
    await db.update(schema.profiles).set({ reviewedAt: null }).where(where)
    expect(await updateProfileAction(original.id, { data: draft })).toEqual({ ok: true })
    expect((await db.select().from(schema.profiles).where(where))[0]?.reviewedAt).toBeNull()
    expect((await updateProfileAction(original.id, { confirm: true })).error).toContain('LinkedIn')
    // A stale reviewed timestamp must not bypass current requirements.
    await db.update(schema.profiles).set({ reviewedAt: 1 }).where(where)
    await expect(queue.enqueueApplication('alice', original.id, job)).rejects.toThrow(/LinkedIn/)
    const noPhone = { ...original.data, personal: { ...original.data.personal, phone: null } }
    expect((await updateProfileAction(original.id, { data: noPhone, confirm: true })).error).toContain('phone')
    expect(await updateProfileAction(original.id, { data: { ...original.data, self_identification: 'leave_blank' }, confirm: true })).toEqual({ ok: true })
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
          self_identification: 'decline',
          personal: { ...original.data.personal, full_name: 'Edited name' },
        },
      })
      .where(eq(schema.profiles.id, original.id))
    const [row] = await db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.id, id))
      .limit(1)
    expect(row.profileSnapshot?.data.personal.full_name).toBe(
      original.data.personal.full_name,
    )
    expect(row.profileSnapshot?.data.self_identification).toBe('leave_blank')
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
