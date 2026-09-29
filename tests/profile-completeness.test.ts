import { describe, expect, it } from 'vitest'
import { contactIssues, isApplicationReady, isLinkedInProfile } from '@/lib/resume/completeness'
import { emptyProfile } from '@/lib/resume/profile-schema'

describe('application contact requirements', () => {
  it.each([
    'https://www.linkedin.com/in/candidate',
    'https://linkedin.com/in/candidate/',
    'https://nl.linkedin.com/in/candidate?trk=resume',
  ])('accepts a personal LinkedIn URL: %s', (url) => expect(isLinkedInProfile(url)).toBe(true))
  it.each([
    '', 'http://linkedin.com/in/candidate', 'https://linkedin.com/company/example',
    'https://linkedin.com/', 'https://linkedin.com/in/',
    'https://linkedin.com.evil.test/in/candidate', 'https://evil-linkedin.com/in/candidate',
    'https://linkedin.com@evil.test/in/candidate', 'https://user@linkedin.com/in/candidate',
    'javascript:alert(1)', 'https://linkedin.com/in/candidate/extra',
  ])('rejects a non-profile URL: %s', (url) => expect(isLinkedInProfile(url)).toBe(false))
  it('requires contact details and explicit review, but not voluntary answers', () => {
    const profile = emptyProfile('Alex', 'alex@example.com')
    expect(contactIssues(profile).phone).not.toBe('')
    expect(contactIssues(profile).linkedin).not.toBe('')
    profile.personal.phone = '+1 415 555 0123'
    profile.links = [{ label: 'LinkedIn', type: 'linkedin', url: 'https://linkedin.com/in/alex' }]
    expect(Object.values(contactIssues(profile)).filter(Boolean)).toEqual([])
    expect(isApplicationReady({ data: profile, reviewedAt: null })).toBe(false)
    expect(isApplicationReady({ data: profile, reviewedAt: 1 })).toBe(true)
    profile.personal.phone = '...----'
    expect(isApplicationReady({ data: profile, reviewedAt: 1 })).toBe(false)
  })
})
