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
  client: vi.fn(),
}))
vi.mock('@/lib/jobo/client', () => ({
  jobo: (...args: unknown[]) => {
    mocked.client(...args)
    return { applications: mocked }
  },
}))
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
process.env.API_KEY_ENCRYPTION_SECRET =
  'fixture-encryption-secret-with-32-characters'
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
  await db.insert(schema.user)
    .values({
      id: 'alice',
      name: 'Alice',
      email: 'alice@example.com',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  const { seedSampleProfiles } = await import('@/db/seed'),
    { RESUME_DIR } = await import('@/db/client')
  await seedSampleProfiles(db, RESUME_DIR)
  for (const row of (await db.select().from(schema.profiles))) {
    await db.update(schema.profiles).set({ data: {
      ...row.data,
      links: { ...row.data.links, linkedin: 'https://www.linkedin.com/in/jobo-test-candidate' },
    } }).where(eq(schema.profiles.id, row.id))
  }
  await db.update(schema.profiles)
    .set({ userId: 'alice', reviewedAt: Date.now() })
    .where(eq(schema.profiles.id, 'sample-ada-lovelace'))
})
beforeEach(async () => {
  await db.delete(schema.steps)
  await db.delete(schema.applications)
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
  id = await queue.enqueueApplication('alice', 'sample-ada-lovelace', job)
  await queue.claimApplication('worker')
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
      (await db
        .select()
        .from(schema.applications)
        .where(eq(schema.applications.id, id)))[0]?.status,
    ).toBe('submitted')
    const [step] = await db.select().from(schema.steps)
      .limit(1)
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
    expect((await db.select().from(schema.steps))[0]?.answersJson).toEqual([
      { field_id: 'full_name', value: 'Ada Lovelace' },
    ])
    await queue.releaseLease(id, 'worker')
    await queue.claimApplication('replacement')
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
  it('stops when a required field has no answer, naming the model failure', async () => {
    mocked.build.mockResolvedValue({
      answers: [],
      trace: [{ field_id: 'full_name', label: 'Full name', type: 'text', source: 'dropped', reason: 'model declined to answer' }],
      unanswerable: [{ label: 'Work authorization' }],
      llmError: 'OpenRouter timed out after 90000ms',
    })
    mocked.get.mockResolvedValue(
      snapshot({ status: 'canceled', current_step: null }),
    )
    await engine.advanceApplication(id, 'worker')
    expect(mocked.submitAnswers).not.toHaveBeenCalled()
    expect(mocked.cancel).toHaveBeenCalled()
    const [{ stopReason }] = await db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.id, id))
    expect(stopReason).toContain('OpenRouter timed out')
    expect(stopReason).toContain('Work authorization')
    // The trace survives the cancel, so the answers tab can explain it.
    const [step] = await db.select().from(schema.steps)
      .limit(1)
    expect(step.trace?.[0]?.reason).toBe('model declined to answer')
    expect(step.answersJson).toBeNull()
  })
  it('names missing profile facts when the model was not at fault', async () => {
    mocked.build.mockResolvedValue({
      answers: [],
      trace: [],
      unanswerable: [{ label: 'Available date' }],
    })
    mocked.get.mockResolvedValue(
      snapshot({ status: 'canceled', current_step: null }),
    )
    await engine.advanceApplication(id, 'worker')
    expect(
      (await db
        .select()
        .from(schema.applications)
        .where(eq(schema.applications.id, id)))[0]?.stopReason,
    ).toBe('Your profile is missing required information: Available date')
  })
  it('submits the profile answers when the model fails but nothing required is missing', async () => {
    mocked.build.mockResolvedValue({
      answers: [{ field_id: 'full_name', value: 'Ada Lovelace' }],
      trace: [],
      unanswerable: [],
      llmError: 'OpenRouter timed out after 90000ms',
    })
    await engine.advanceApplication(id, 'worker')
    expect(mocked.cancel).not.toHaveBeenCalled()
    expect(mocked.submitAnswers).toHaveBeenCalledTimes(1)
    expect((await db.select().from(schema.steps))[0]?.error).toBe(
      'OpenRouter timed out after 90000ms',
    )
  })
  it('stops when the answer service refuses its key', async () => {
    mocked.build.mockResolvedValue({
      answers: [{ field_id: 'full_name', value: 'Ada Lovelace' }],
      trace: [],
      unanswerable: [],
      llmError: 'OpenRouter 402: Insufficient credits',
      llmFatal: true,
    })
    mocked.get.mockResolvedValue(
      snapshot({ status: 'canceled', current_step: null }),
    )
    await engine.advanceApplication(id, 'worker')
    expect(mocked.submitAnswers).not.toHaveBeenCalled()
    expect(
      (await db
        .select()
        .from(schema.applications)
        .where(eq(schema.applications.id, id)))[0]?.stopReason,
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
    await db.update(schema.applications)
      .set({ cancelRequested: true })
      .where(eq(schema.applications.id, id))
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
    await db.update(schema.applications)
      .set({ createdAt: Date.now() - 21 * 3600000 })
      .where(eq(schema.applications.id, id))
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
    expect((await db.select().from(schema.steps))).toHaveLength(2)
    expect(mocked.submitAnswers.mock.calls[1][2]).toMatchObject({
      correctionRound: 1,
    })
  })
  it('pauses unknown intake after six failures instead of repeatedly creating applications', async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      await queue.releaseLease(id, 'worker', 'Network failure')
      await db.update(schema.applications)
        .set({ nextAttemptAt: 0 })
        .where(eq(schema.applications.id, id))
      if (attempt < 5) expect((await queue.claimApplication('worker'))?.id).toBe(id)
    }
    expect(
      (await db
        .select()
        .from(schema.applications)
        .where(eq(schema.applications.id, id)))[0]?.status,
    ).toBe('recovery_required')
    expect(await queue.claimApplication('worker')).toBeNull()
  })
})
describe('production mode', () => {
  const realJobId = '3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'
  const realJob = {
    slug: realJobId,
    company: 'Acme',
    mark: 'AC',
    role: 'Backend engineer',
    location: 'Berlin, Germany',
    department: 'Greenhouse',
    employmentType: 'Full-time',
    about: 'APIs',
    responsibilities: [],
    applyUrl: 'https://job-boards.greenhouse.io/acme/jobs/123',
    available: true,
    production: true,
    source: 'greenhouse',
    countryCode: 'DE',
  }
  async function enqueueProduction() {
    // The shared beforeEach queued (and leased) a sandbox run for alice; the
    // per-user cap would hold the production one back behind it.
    await db.delete(schema.applications)
    const { sealApiKey } = await import('@/lib/user-settings')
    const prodId = await queue.enqueueApplication('alice', 'sample-ada-lovelace', realJob, false, {
      apiKeyCiphertext: sealApiKey('jbe_live_visitor_key_fixture_0000000000'),
    })
    await queue.claimApplication('worker')
    return prodId
  }
  it('creates by job id on the visitor’s own key and forgets the key once terminal', async () => {
    const prodId = await enqueueProduction()
    await engine.advanceApplication(prodId, 'worker')
    expect(mocked.create).toHaveBeenCalledWith(
      { job_id: realJobId },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    )
    for (const call of mocked.client.mock.calls)
      expect(call).toEqual([prodId, 'jbe_live_visitor_key_fixture_0000000000'])
    expect(mocked.build.mock.calls[0][1].jobCountryCode).toBe('DE')
    const [row] = await db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.id, prodId))
    expect(row.status).toBe('submitted')
    expect(row.sandbox).toBe(false)
    expect(row.apiKeyCiphertext).toBeNull()
  })
  it('keeps sandbox runs on the deployment key and the sandbox URL', async () => {
    await engine.advanceApplication(id, 'worker')
    expect(mocked.create.mock.calls[0][0]).toEqual({
      apply_url: 'https://sandbox.jobo.world/apply/multi-step',
    })
    expect(mocked.client.mock.calls.every((call) => call.length === 1)).toBe(true)
  })
  it('stops instead of retrying when the stored key is gone', async () => {
    const prodId = await enqueueProduction()
    await db.update(schema.applications)
      .set({ apiKeyCiphertext: 'v1.garbage.garbage.garbage' })
      .where(eq(schema.applications.id, prodId))
    await engine.advanceApplication(prodId, 'worker')
    expect(mocked.create).not.toHaveBeenCalled()
    const [row] = await db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.id, prodId))
    expect(row.status).toBe('create_failed')
    expect(row.stopReason).toMatch(/API key/)
  })
  it('explains an account without Auto Apply access', async () => {
    const prodId = await enqueueProduction()
    const { JoboAPIError } = await import('@jobo-ai/autoapply')
    mocked.create.mockRejectedValueOnce(
      new JoboAPIError({
        status: 403,
        code: 'auto_apply_not_enabled',
        detail: 'This account does not have access to Auto Apply.',
      }),
    )
    await engine.advanceApplication(prodId, 'worker')
    const [row] = await db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.id, prodId))
    expect(row.status).toBe('create_failed')
    expect(row.createErrorCode).toBe('auto_apply_not_enabled')
    expect(row.failureMessage).toMatch(/not enabled/)
    expect(row.apiKeyCiphertext).toBeNull()
  })
})
