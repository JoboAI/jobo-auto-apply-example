import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'jobo-signed-'))
process.env.JOBO_API_KEY = 'jbe_test_fixture'
process.env.OPENROUTER_API_KEY = 'fixture'
process.env.PUBLIC_BASE_URL = 'https://demo.jobo.world'
process.env.RESUME_URL_SIGNING_SECRET =
  'independent-test-signing-secret-32-characters'
let id: string
beforeAll(async () => {
  const { db, RESUME_DIR } = await import('@/db/client')
  const { user, profiles } = await import('@/db/schema')
  await db.insert(user)
    .values({
      id: 'owner',
      name: 'Owner',
      email: 'owner@example.com',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  const { seedSampleProfiles } = await import('@/db/seed')
  await seedSampleProfiles(db, RESUME_DIR)
  for (const row of (await db.select().from(profiles))) {
    await db.update(profiles).set({ data: {
      ...row.data,
      links: [...row.data.links, { label: 'LinkedIn', type: 'linkedin', url: 'https://www.linkedin.com/in/jobo-test-candidate' }],
    } }).where(eq(profiles.id, row.id))
  }
  await db.update(profiles)
    .set({ userId: 'owner', reviewedAt: Date.now() })
    .where(eq(profiles.id, 'sample-ada-lovelace'))
  const { enqueueApplication } = await import('@/lib/queue')
  id = await enqueueApplication('owner', 'sample-ada-lovelace', {
    slug: 'multi-step',
    company: 'Cascade',
    mark: 'CA',
    role: 'Data engineer',
    location: 'NL',
    department: 'Data',
    employmentType: 'Full-time',
    about: 'Data',
    responsibilities: [],
    applyUrl: 'https://sandbox.jobo.world/apply/multi-step',
    available: true,
  })
})
it('serves only an application snapshot with an unexpired, correctly scoped signature', async () => {
  const { signApplicationResumeUrl } = await import('@/lib/signed-url')
  const { GET } = await import('@/app/api/application-resumes/[id]/route')
  const params = { params: Promise.resolve({ id }) },
    url = signApplicationResumeUrl(id)
  const ok = await GET(new Request(url), params)
  expect(ok.status).toBe(200)
  expect(ok.headers.get('content-type')).toBe('application/pdf')
  expect(new TextDecoder().decode((await ok.arrayBuffer()).slice(0, 5))).toBe(
    '%PDF-',
  )
  expect(
    (await GET(new Request(url.replace('token=', 'token=bad')), params)).status,
  ).toBe(403)
  expect(
    (await GET(new Request(signApplicationResumeUrl(id, -1)), params)).status,
  ).toBe(410)
  expect(
    (
      await GET(new Request(url), {
        params: Promise.resolve({ id: 'another-application' }),
      })
    ).status,
  ).toBe(403)
})
