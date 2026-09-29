import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
const mocked = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  submitAnswers: vi.fn(),
  cancel: vi.fn(),
  build: vi.fn(),
}))
vi.mock('@/lib/jobo/client', () => ({ jobo: () => ({ applications: mocked }) }))
vi.mock('@/lib/answers', () => ({
  buildAnswers: mocked.build,
  repairAnswers: vi.fn(),
}))
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'jobo-engine-'))
process.env.JOBO_API_KEY = 'jbe_test_fixture'
process.env.OPENROUTER_API_KEY = 'fixture'
process.env.PUBLIC_BASE_URL = 'https://demo.jobo.world'
process.env.RESUME_URL_SIGNING_SECRET =
  'fixture-signing-secret-with-32-characters'
let db: typeof import('@/db/client').db,
  schema: typeof import('@/db/schema'),
  queue: typeof import('@/lib/queue'),
  engine: typeof import('@/lib/application-engine')
let id: string
function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'upstream',
    provider_id: 'sandbox',
    provider_name: 'Sandbox',
    status: 'awaiting_answers',
    failure: null,
    current_step: {
      id: 'step-1',
      sequence: 1,
      correction_round: 0,
      fields: [
        {
          field_id: 'full_name',
          label: 'Full name',
          type: 'text',
          requires_answer: true,
        },
      ],
      command_errors: [],
      answers_expire_at: new Date(Date.now() + 60000).toISOString(),
    },
    ...overrides,
  }
}
beforeAll(async () => {
  ;({ db } = await import('@/db/client'))
  schema = await import('@/db/schema')
  queue = await import('@/lib/queue')
  engine = await import('@/lib/application-engine')
  db.insert(schema.user)
    .values({
      id: 'alice',
      name: 'Alice',
      email: 'alice@example.com',
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
})
beforeEach(() => {
  db.delete(schema.steps).run()
  db.delete(schema.applications).run()
  vi.clearAllMocks()
  const job = {
    slug: 'multi-step',
    company: 'Cascade',
    mark: 'CA',
    role: 'Data engineer',
    location: 'NL',
    department: 'Data',
    employmentType: 'Full-time',
    about: 'Data pipelines',
    responsibilities: ['Build data products'],
    applyUrl: 'https://sandbox.jobo.world/apply/multi-step',
    available: true,
  }
  id = queue.enqueueApplication('alice', 'sample-ada-lovelace', job)
  queue.claimApplication('worker')
  mocked.create.mockResolvedValue(snapshot())
  mocked.get.mockResolvedValue(snapshot())
  mocked.submitAnswers.mockResolvedValue(
    snapshot({ status: 'submitted', current_step: null }),
  )
  mocked.cancel.mockResolvedValue({ status: 'canceled' })
  mocked.build.mockResolvedValue({
    answers: [{ field_id: 'full_name', value: 'Ada Lovelace' }],
    trace: [],
    unanswerable: [],
    llmModel: 'deepseek/deepseek-v4-flash-0731',
    llmMs: 20,
  })
})
describe('background application exchanges', () => {
  it('submits from snapshots and records the actual model and authoritative status', async () => {
    await engine.advanceApplication(id, 'worker')
    expect(
      db
        .select()
        .from(schema.applications)
        .where(eq(schema.applications.id, id))
        .get()?.status,
    ).toBe('submitted')
    const step = db.select().from(schema.steps).get()!
    expect(step.llmModel).toBe('deepseek/deepseek-v4-flash-0731')
    expect(step.submittedAt).toBeTruthy()
    const context = mocked.build.mock.calls[0][1]
    expect(context.jobDescription).toContain('Data pipelines')
    expect(context.budgetMs).toBeLessThanOrEqual(40000)
    expect(context.resumeUrl).toContain(`/api/application-resumes/${id}`)
  })
  it('replays identical persisted answers after interruption without another model call', async () => {
    mocked.submitAnswers.mockRejectedValueOnce(new Error('Connection lost'))
    await expect(engine.advanceApplication(id, 'worker')).rejects.toThrow(
      'Connection lost',
    )
    expect(db.select().from(schema.steps).get()?.answersJson).toEqual([
      { field_id: 'full_name', value: 'Ada Lovelace' },
    ])
    queue.releaseLease(id, 'worker')
    queue.claimApplication('replacement')
    await engine.advanceApplication(id, 'replacement')
    expect(mocked.create).toHaveBeenCalledTimes(1)
    expect(mocked.build).toHaveBeenCalledTimes(1)
    expect(mocked.submitAnswers.mock.calls[1][1]).toEqual(
      mocked.submitAnswers.mock.calls[0][1],
    )
  })
  it('reuses the persisted create key after a dropped create response', async () => {
    mocked.create.mockRejectedValueOnce(new Error('Connection lost'))
    await expect(engine.advanceApplication(id, 'worker')).rejects.toThrow()
    await engine.advanceApplication(id, 'worker')
    expect(mocked.create.mock.calls[0][1]).toEqual(
      mocked.create.mock.calls[1][1],
    )
  })
  it('stops missing facts or model failures without submitting', async () => {
    mocked.build.mockResolvedValue({
      answers: [],
      trace: [],
      unanswerable: [{ label: 'Work authorization' }],
      llmError: 'upstream failed',
    })
    mocked.get.mockResolvedValue(
      snapshot({ status: 'canceled', current_step: null }),
    )
    await engine.advanceApplication(id, 'worker')
    expect(mocked.submitAnswers).not.toHaveBeenCalled()
    expect(mocked.cancel).toHaveBeenCalled()
    expect(
      db
        .select()
        .from(schema.applications)
        .where(eq(schema.applications.id, id))
        .get()?.stopReason,
    ).toContain('answer service')
  })
  it('stops verification without asking the model to invent a code', async () => {
    const step = snapshot().current_step
    mocked.create.mockResolvedValue(
      snapshot({
        current_step: {
          ...step,
          fields: [
            {
              field_id: 'code',
              type: 'text',
              format: 'one_time_code',
              requires_answer: true,
            },
          ],
        },
      }),
    )
    mocked.get.mockResolvedValue(
      snapshot({ status: 'canceled', current_step: null }),
    )
    await engine.advanceApplication(id, 'worker')
    expect(mocked.build).not.toHaveBeenCalled()
    expect(mocked.submitAnswers).not.toHaveBeenCalled()
  })
  it('honors cancellation before generating or submitting answers', async () => {
    db.update(schema.applications)
      .set({ cancelRequested: true })
      .where(eq(schema.applications.id, id))
      .run()
    mocked.get.mockResolvedValue(
      snapshot({ status: 'canceled', current_step: null }),
    )
    await engine.advanceApplication(id, 'worker')
    expect(mocked.cancel).toHaveBeenCalled()
    expect(mocked.build).not.toHaveBeenCalled()
  })
  it('rejects stale workers and avoids replaying expired idempotency keys', async () => {
    await expect(
      engine.advanceApplication(id, 'not-the-owner'),
    ).rejects.toThrow(/lease/)
    db.update(schema.applications)
      .set({ createdAt: Date.now() - 21 * 3600000 })
      .where(eq(schema.applications.id, id))
      .run()
    await expect(engine.advanceApplication(id, 'worker')).rejects.toThrow(
      /idempotency/,
    )
    expect(mocked.create).not.toHaveBeenCalled()
  })
})

describe('correction and retry recovery', () => {
  it('keeps correction rounds separate and carries forward the prior answer snapshot', async () => {
    const correction = snapshot({
      current_step: {
        ...snapshot().current_step,
        correction_round: 1,
        command_errors: [
          {
            field_id: 'full_name',
            code: 'invalid_value',
            message: 'Check name',
            item_index: null,
            field_key: null,
          },
        ],
      },
    })
    mocked.submitAnswers.mockResolvedValueOnce(correction)
    await engine.advanceApplication(id, 'worker')
    mocked.get.mockResolvedValue(correction)
    await engine.advanceApplication(id, 'worker')
    expect(mocked.build.mock.calls[1][1]).toMatchObject({
      correctionRound: 1,
      previousAnswers: [{ field_id: 'full_name', value: 'Ada Lovelace' }],
    })
    expect(db.select().from(schema.steps).all()).toHaveLength(2)
    expect(mocked.submitAnswers.mock.calls[1][2]).toMatchObject({
      correctionRound: 1,
    })
  })
  it('pauses unknown intake after six failures instead of repeatedly creating applications', () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      queue.releaseLease(id, 'worker', 'Network failure')
      db.update(schema.applications)
        .set({ nextAttemptAt: 0 })
        .where(eq(schema.applications.id, id))
        .run()
      if (attempt < 5) expect(queue.claimApplication('worker')?.id).toBe(id)
    }
    expect(
      db
        .select()
        .from(schema.applications)
        .where(eq(schema.applications.id, id))
        .get()?.status,
    ).toBe('recovery_required')
    expect(queue.claimApplication('worker')).toBeNull()
  })
})
