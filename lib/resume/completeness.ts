import { z } from 'zod'
import type { ResumeProfile } from './profile-schema'

export function isLinkedInProfile(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return (
      url.protocol === 'https:' &&
      /^(?:[a-z]{2,3}\.)?linkedin\.com$/i.test(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^\/in\/[^/\s]+\/?$/.test(url.pathname)
    )
  } catch {
    return false
  }
}

export function contactIssues(profile: ResumeProfile) {
  return {
    name:
      profile.personal.first_name.trim() && profile.personal.last_name.trim()
        ? ''
        : 'Add your first and last name.',
    email: z.string().email().safeParse(profile.personal.email.trim()).success
      ? ''
      : 'Add a valid email address.',
    phone:
      /^\+?[\d\s().-]{7,25}$/.test(profile.personal.phone?.trim() ?? '') &&
      (profile.personal.phone?.replace(/\D/g, '').length ?? 0) >= 7
        ? ''
        : 'Add a valid phone number, including your country code.',
    linkedin: isLinkedInProfile(profile.links.linkedin ?? '')
      ? ''
      : 'Add a LinkedIn profile URL, such as https://www.linkedin.com/in/your-name.',
  }
}

/**
 * The "Equal Employment Info" checklist: every question answered.
 * "Decline to state" is an answer; leaving it untouched is not, because then
 * nobody — not the candidate, not this app — has decided what the form gets.
 */
export function employmentIssues(profile: ResumeProfile) {
  const auth = profile.work_authorization
  const eeo = profile.eeo
  const unanswered = (value: unknown) => value === null || value === undefined
  return {
    work_authorization: [auth.us, auth.canada, auth.uk].some(unanswered)
      ? 'Answer whether you can work in the US, Canada and the UK.'
      : '',
    sponsorship: unanswered(auth.requires_sponsorship)
      ? 'Answer whether you will need visa sponsorship.'
      : '',
    gender: unanswered(eeo.gender) ? 'Choose a gender option, or decline to state.' : '',
    ethnicity: !eeo.ethnicity?.length ? 'Choose your ethnicity, or decline to state.' : '',
    veteran: unanswered(eeo.veteran) ? 'Answer the veteran question, or decline to state.' : '',
    disability: unanswered(eeo.disability)
      ? 'Answer the disability question, or decline to state.'
      : '',
    lgbtq: unanswered(eeo.lgbtq) ? 'Answer the LGBTQ+ question, or decline to state.' : '',
  }
}

export function profileIssues(profile: ResumeProfile): string[] {
  return [
    ...Object.values(contactIssues(profile)),
    ...Object.values(employmentIssues(profile)),
  ].filter(Boolean)
}

export function isApplicationReady(profile: { reviewedAt: number | null; data: ResumeProfile }) {
  return !!profile.reviewedAt && profileIssues(profile.data).length === 0
}
