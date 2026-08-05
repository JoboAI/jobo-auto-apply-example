import { describe, expect, it } from 'vitest'
import { ATS_HOSTS, hostAllowed, parseAllowedHosts } from '@/lib/apply-hosts'

/**
 * This is the guard that makes a shared deployment safe to hand out. Getting it
 * wrong does not throw — it lets a stranger submit a real application to a real
 * employer on the deployment's API key and quota.
 */

describe('parseAllowedHosts', () => {
  it('splits, trims and lowercases', () => {
    expect(parseAllowedHosts(' Sandbox.Jobo.World , jobs.ashbyhq.com ')).toEqual([
      'sandbox.jobo.world',
      'jobs.ashbyhq.com'
    ])
  })

  it('drops empty entries from sloppy input', () => {
    expect(parseAllowedHosts('a.com,,b.com,')).toEqual(['a.com', 'b.com'])
  })
})

describe('hostAllowed', () => {
  const allowed = [...ATS_HOSTS]

  it.each(allowed)('accepts %s', (host) => {
    expect(hostAllowed(host, allowed)).toBe(true)
  })

  it('is case-insensitive on the host', () => {
    expect(hostAllowed('Boards.Greenhouse.IO', allowed)).toBe(true)
  })

  it.each([
    ['boards.greenhouse.io.attacker.test', 'suffix-appended lookalike'],
    ['evil-greenhouse.io', 'prefix-glued lookalike'],
    ['notjobs.ashbyhq.com', 'prefixed subdomain'],
    ['greenhouse.io', 'the bare domain is not a board host'],
    ['sandbox.jobo.world.evil.com', 'sandbox lookalike'],
    ['jobs.lever.co', 'an ATS that was not allowed'],
    ['', 'empty host']
  ])('refuses %s (%s)', (host) => {
    expect(hostAllowed(host, allowed)).toBe(false)
  })

  it('treats a leading-dot entry as a real domain suffix', () => {
    const suffix = ['.greenhouse.io']
    expect(hostAllowed('boards.greenhouse.io', suffix)).toBe(true)
    expect(hostAllowed('job-boards.eu.greenhouse.io', suffix)).toBe(true)
    // The whole reason for requiring the dot:
    expect(hostAllowed('greenhouse.io.attacker.test', suffix)).toBe(false)
    expect(hostAllowed('evilgreenhouse.io', suffix)).toBe(false)
  })

  it('refuses everything when the allowlist is empty', () => {
    expect(hostAllowed('sandbox.jobo.world', [])).toBe(false)
  })
})
