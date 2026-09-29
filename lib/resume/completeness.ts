import { z } from 'zod'
import type { ResumeProfile } from './profile-schema'

export function isLinkedInProfile(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' &&
      /^(?:[a-z]{2,3}\.)?linkedin\.com$/i.test(url.hostname) &&
      !url.username && !url.password && !url.port &&
      /^\/in\/[^/\s]+\/?$/.test(url.pathname)
  } catch {
    return false
  }
}

export function contactIssues(profile: ResumeProfile) {
  const linkedin = profile.links.find((link) => link.type === 'linkedin')?.url ?? ''
  return {
    name: profile.personal.full_name.trim() ? '' : 'Add your full name.',
    email: z.string().email().safeParse(profile.personal.email.trim()).success
      ? '' : 'Add a valid email address.',
    phone: /^\+?[\d\s().-]{7,25}$/.test(profile.personal.phone?.trim() ?? '') &&
      (profile.personal.phone?.replace(/\D/g, '').length ?? 0) >= 7
      ? '' : 'Add a valid phone number, including your country code.',
    linkedin: isLinkedInProfile(linkedin)
      ? '' : 'Add a LinkedIn profile URL, such as https://www.linkedin.com/in/your-name.',
  }
}

export function isApplicationReady(profile: { reviewedAt: number | null; data: ResumeProfile }) {
  return !!profile.reviewedAt && Object.values(contactIssues(profile.data)).every((issue) => !issue)
}
