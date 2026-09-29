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
  expect(db.select().from(schema.profiles).all()).toHaveLength(0)
  for (const id of ['alice', 'bob'])
    db.insert(schema.user)
      .values({
        id,
        name: id,
        email: `${id}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run()
  const { seedSampleProfiles } = await import('@/db/seed'),
    { RESUME_DIR } = await import('@/db/client')
  seedSampleProfiles(db, RESUME_DIR)
  for (const row of db.select().from(schema.profiles).all()) {
    db.update(schema.profiles).set({ data: {
      ...row.data,
      links: [...row.data.links, { label: 'LinkedIn', type: 'linkedin', url: 'https://www.linkedin.com/in/jobo-test-candidate' }],
    } }).where(eq(schema.profiles.id, row.id)).run()
  }
  db.update(schema.profiles)
    .set({ userId: 'alice', reviewedAt: Date.now() })
    .where(eq(schema.profiles.id, 'sample-ada-lovelace'))
    .run()
  db.update(schema.profiles)
    .set({ userId: 'bob', reviewedAt: Date.now() })
    .where(eq(schema.profiles.id, 'sample-grace-hopper'))
    .run()
})
describe('private profiles and durable applications', () => {
  it('rejects another user’s resume and non-sandbox URLs', () => {
    expect(() =>
      queue.enqueueApplication('bob', 'sample-ada-lovelace', job),
    ).toThrow(/Review/)
    expect(() =>
      queue.enqueueApplication('alice', 'sample-ada-lovelace', {
        ...job,
        applyUrl: 'https://example.com/apply/multi-step',
      }),
    ).toThrow(/Invalid/)
  })
  it('requires confirmation before application creation', () => {
    db.update(schema.profiles)
      .set({ reviewedAt: null })
      .where(eq(schema.profiles.id, 'sample-ada-lovelace'))
      .run()
    expect(() =>
      queue.enqueueApplication('alice', 'sample-ada-lovelace', job),
    ).toThrow(/Review/)
    db.update(schema.profiles)
      .set({ reviewedAt: Date.now() })
      .where(eq(schema.profiles.id, 'sample-ada-lovelace'))
      .run()
  })
  it('saves incomplete drafts but requires LinkedIn and phone for confirmation and enqueue', async () => {
    const { updateProfileAction } = await import('@/app/actions/profiles')
    const where = eq(schema.profiles.id, 'sample-ada-lovelace')
    const original = db.select().from(schema.profiles).where(where).get()!
    const draft = { ...original.data, links: [], self_identification: 'leave_blank' as const }
    db.update(schema.profiles).set({ reviewedAt: null }).where(where).run()
    expect(await updateProfileAction(original.id, { data: draft })).toEqual({ ok: true })
    expect(db.select().from(schema.profiles).where(where).get()?.reviewedAt).toBeNull()
    expect((await updateProfileAction(original.id, { confirm: true })).error).toContain('LinkedIn')
    // A stale reviewed timestamp must not bypass current requirements.
    db.update(schema.profiles).set({ reviewedAt: 1 }).where(where).run()
    expect(() => queue.enqueueApplication('alice', original.id, job)).toThrow(/LinkedIn/)
    const noPhone = { ...original.data, personal: { ...original.data.personal, phone: null } }
    expect((await updateProfileAction(original.id, { data: noPhone, confirm: true })).error).toContain('phone')
    expect(await updateProfileAction(original.id, { data: { ...original.data, self_identification: 'leave_blank' }, confirm: true })).toEqual({ ok: true })
  })
  it('deduplicates clicks and preserves the original profile and PDF', async () => {
    const id = queue.enqueueApplication('alice', 'sample-ada-lovelace', job)
    expect(queue.enqueueApplication('alice', 'sample-ada-lovelace', job)).toBe(
      id,
    )
    const original = db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, 'sample-ada-lovelace'))
      .get()!
    db.update(schema.profiles)
      .set({
        data: {
          ...original.data,
          self_identification: 'decline',
          personal: { ...original.data.personal, full_name: 'Edited name' },
        },
      })
      .where(eq(schema.profiles.id, original.id))
      .run()
    const row = db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.id, id))
      .get()!
    expect(row.profileSnapshot?.data.personal.full_name).toBe(
      original.data.personal.full_name,
    )
    expect(row.profileSnapshot?.data.self_identification).toBe('leave_blank')
    const { RESUME_DIR } = await import('@/db/client')
    expect(readFileSync(join(RESUME_DIR, `${id}.pdf`))).toEqual(
      readFileSync(join(RESUME_DIR, `${original.id}.pdf`)),
    )
  })
  it('enforces global and per-user concurrency and recovers expired leases', () => {
    const otherJob = {
      ...job,
      slug: 'all-field-types',
      applyUrl: 'https://sandbox.jobo.world/apply/all-field-types',
    }
    queue.enqueueApplication('alice', 'sample-ada-lovelace', otherJob)
    queue.enqueueApplication('bob', 'sample-grace-hopper', job)
    const now = Date.now(),
      a = queue.claimApplication('worker-a', 2, 1, now)!,
      b = queue.claimApplication('worker-b', 2, 1, now)!
    expect(a.userId).not.toBe(b.userId)
    expect(queue.claimApplication('worker-c', 2, 1, now)).toBeNull()
    const recovered = queue.claimApplication(
      'worker-c',
      2,
      1,
      now + queue.LEASE_MS + 1,
    )!
    expect(recovered.id).toBe(a.id)
    expect(queue.renewLease(recovered.id, 'worker-a')).toBe(false)
    queue.releaseLease(recovered.id, 'worker-c')
    queue.releaseLease(b.id, 'worker-b')
  })
  it('does not retry ambiguous or confirmed submitted applications', () => {
    const id = queue.enqueueApplication('alice', 'sample-ada-lovelace', job)
    db.update(schema.applications)
      .set({ status: 'submitted' })
      .where(eq(schema.applications.id, id))
      .run()
    expect(
      queue.enqueueApplication('alice', 'sample-ada-lovelace', job, true),
    ).toBe(id)
    db.update(schema.applications)
      .set({ status: 'failed', failureCode: 'submission_unconfirmed' })
      .where(eq(schema.applications.id, id))
      .run()
    expect(
      queue.enqueueApplication('alice', 'sample-ada-lovelace', job, true),
    ).toBe(id)
    db.update(schema.applications)
      .set({ status: 'failed', failureCode: 'answers_timeout' })
      .where(eq(schema.applications.id, id))
      .run()
    expect(
      queue.enqueueApplication('alice', 'sample-ada-lovelace', job, true),
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
      db
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.id, 'sample-grace-hopper'))
        .get()?.archived,
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
    const other = db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.userId, 'bob'))
      .get()!
    const { cancelApplicationAction } =
      await import('@/app/actions/applications')
    expect((await cancelApplicationAction(other.id)).ok).toBe(false)
    expect(
      db
        .select()
        .from(schema.applications)
        .where(eq(schema.applications.id, other.id))
        .get()?.cancelRequested,
    ).toBe(false)
  })
  it('archives profiles without deleting application history', async () => {
    const { deleteProfileAction } = await import('@/app/actions/profiles')
    const count = db.select().from(schema.applications).all().length
    await deleteProfileAction('sample-ada-lovelace')
    expect(
      db
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.id, 'sample-ada-lovelace'))
        .get()?.archived,
    ).toBe(true)
    expect(db.select().from(schema.applications).all()).toHaveLength(count)
  })
})
