import { describe, expect, it } from 'vitest'
import { isJobId, isoCountryCode, validApplyTarget } from '@/lib/jobs'
import { sandboxJob } from '@/tests/support/jobs'

const job = sandboxJob()
const real = sandboxJob(2, {
  applyUrl: 'https://jobs.lever.co/acme/1',
  source: 'lever',
  sourceName: 'Lever',
})

describe('apply targets', () => {
  it('lets each mode apply only to its own jobs', () => {
    expect(validApplyTarget('sandbox', job)).toBe(true)
    expect(validApplyTarget('sandbox', real)).toBe(false)
    expect(validApplyTarget('production', real)).toBe(true)
    expect(validApplyTarget('production', job)).toBe(false)
  })
  it('needs a Jobo job id', () => {
    expect(validApplyTarget('sandbox', { ...job, slug: 'multi-step' })).toBe(false)
    expect(validApplyTarget('production', { ...real, slug: 'multi-step' })).toBe(false)
  })
})

describe('ids and countries', () => {
  it('keys jobs by Jobo UUID', () => {
    expect(isJobId(job.slug)).toBe(true)
    expect(isJobId('multi-step')).toBe(false)
  })
  it.each([
    ['UK', 'GB'],
    ['us', 'US'],
    ['United Kingdom', undefined],
    [null, undefined],
  ])('%s → %s', (value, expected) => {
    expect(isoCountryCode(value)).toBe(expected)
  })
})
