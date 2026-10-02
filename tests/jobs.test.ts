import { afterEach, describe, expect, it, vi } from 'vitest'
import { getJobs, jobCountryCode, validSandboxUrl } from '@/lib/jobs'
const metadata = {
  slug: 'multi-step',
  company: 'Cascade',
  mark: 'CA',
  role: 'Data engineer',
  location: 'NL',
  department: 'Data',
  employmentType: 'Full-time',
  about: 'Data',
  responsibilities: [],
  available: true,
  apply_url: 'https://sandbox.jobo.world/apply/multi-step',
}
afterEach(() => {
  vi.unstubAllGlobals()
})
describe('sandbox catalog', () => {
  it.each([
    'http://sandbox.jobo.world/apply/multi-step',
    'https://sandbox.jobo.world.evil.com/apply/multi-step',
    'https://x:s@sandbox.jobo.world/apply/multi-step',
    'https://sandbox.jobo.world/apply/multi-step?next=https://evil.test',
    'https://sandbox.jobo.world:8443/apply/multi-step',
    'https://jobs.ashbyhq.com/example',
    'https://sandbox.jobo.world/apply/other',
  ])('rejects %s', (url) =>
    expect(validSandboxUrl(url, 'multi-step')).toBe(false),
  )
  it('uses catalog URLs, hides interactive tests, and honors the availability gate', async () => {
    let available = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          available,
          jobs: [
            metadata,
            { ...metadata, slug: 'email-verification' },
            { ...metadata, slug: 'login-wall' },
            { ...metadata, slug: 'unknown' },
          ],
        }),
      ),
    )
    const jobs = await getJobs()
    expect(jobs).toHaveLength(2)
    expect(jobs[0].available).toBe(true)
    expect(jobs[1].available).toBe(false)
    available = false
    expect((await getJobs())[0].available).toBe(false)
  })
  it('does not invent jobs when the source is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    )
    await expect(getJobs()).rejects.toThrow(/unavailable/)
  })
})

describe('posting country', () => {
  it.each([
    ['Manchester, UK', 'GB'],
    ['Austin, TX, US', 'US'],
    ['Toronto, ON, CA', 'CA'],
    ['Berlin, DE', 'DE'],
    ['Remote — Europe', undefined],
    ['NL', undefined],
  ])('%s → %s', (location, expected) => {
    expect(jobCountryCode(location)).toBe(expected)
  })
})
