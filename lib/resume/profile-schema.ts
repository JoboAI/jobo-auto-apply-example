import { z } from 'zod'

/**
 * The candidate profile.
 *
 * This is the half of Auto Apply that Jobo deliberately does not own. Jobo
 * stores no profile and no resume — it hands you the form's fields and you
 * produce the answers from something like this.
 *
 * Two shape decisions are load-bearing:
 *
 *  1. Dates are normalised to `YYYY-MM` at import time, once, in one place.
 *     Doing it here rather than at answer time removes an entire class of
 *     `invalid_date` / `date_precision` correction rounds later.
 *
 *  2. The `about` block is what open-ended questions are actually answered
 *     from. "Why do you want to work here?", "Describe a challenge you
 *     overcame" — none of that is in a resume's bullet points. `about` is the
 *     highest-leverage part of this schema, which is why the UI surfaces
 *     `about.freeform_notes` as a prominent editable textarea.
 */

const yearMonth = z
  .string()
  .describe('Normalised to YYYY-MM. Use YYYY-01 if only a year is known.')

export const linkTypes = ['linkedin', 'github', 'portfolio', 'website', 'other'] as const
export const remotePreferences = ['remote', 'hybrid', 'onsite', 'no_preference'] as const

export const resumeProfileSchema = z.object({
  personal: z.object({
    full_name: z.string(),
    first_name: z.string(),
    last_name: z.string(),
    email: z.string(),
    phone: z.string().nullable().describe('E.164 where possible, e.g. +14155550123'),
    headline: z.string().nullable().describe('One line, e.g. "Senior Backend Engineer"'),
    pronouns: z.string().nullable()
  }),

  location: z.object({
    line1: z.string().nullable(),
    line2: z.string().nullable(),
    city: z.string().nullable(),
    region: z.string().nullable().describe('State / province'),
    postal_code: z.string().nullable(),
    country_code: z.string().nullable().describe('ISO 3166-1 alpha-2, e.g. US, GB, NL'),
    country_name: z.string().nullable()
  }),

  links: z.array(
    z.object({
      label: z.string(),
      type: z.enum(linkTypes),
      url: z.string()
    })
  ),

  work_experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      employment_type: z.string().nullable().describe('e.g. Full-time, Contract, Internship'),
      location: z.string().nullable(),
      start_date: yearMonth,
      end_date: yearMonth.nullable().describe('null when is_current is true'),
      is_current: z.boolean(),
      description: z.string().describe('2-4 sentences of what they did and achieved')
    })
  ),

  education: z.array(
    z.object({
      school: z.string(),
      degree: z.string().nullable().describe("e.g. BSc, MSc, Bachelor's"),
      field_of_study: z.string().nullable(),
      start_date: yearMonth.nullable(),
      end_date: yearMonth.nullable(),
      is_current: z.boolean(),
      grade: z.string().nullable()
    })
  ),

  skills: z.array(
    z.object({
      name: z.string(),
      level: z.string().nullable().describe('e.g. Expert, Proficient, Familiar')
    })
  ),

  languages: z.array(
    z.object({
      name: z.string(),
      proficiency: z.string().nullable().describe('e.g. Native, Fluent, Conversational')
    })
  ),

  certifications: z.array(
    z.object({
      name: z.string(),
      issuer: z.string().nullable(),
      issued: yearMonth.nullable()
    })
  ),

  work_authorization: z.object({
    authorized_country_codes: z
      .array(z.string())
      .describe('ISO alpha-2 codes the candidate can already work in'),
    requires_sponsorship: z.boolean().nullable(),
    notice_period_days: z.number().nullable()
  }),

  preferences: z.object({
    desired_salary: z.number().nullable(),
    salary_currency: z.string().nullable().describe('ISO 4217, e.g. USD'),
    willing_to_relocate: z.boolean().nullable(),
    remote_preference: z.enum(remotePreferences).nullable(),
    earliest_start_date: z.string().nullable().describe('YYYY-MM-DD')
  }),

  about: z.object({
    summary: z.string().describe('2-3 sentence professional summary in the first person'),
    motivation: z
      .string()
      .describe('What kind of role and company they are looking for, and why'),
    strengths: z.array(z.string()).describe('3-6 short phrases'),
    notable_projects: z.array(z.string()).describe('Short descriptions of concrete work'),
    freeform_notes: z
      .string()
      .describe('Anything else useful when answering open-ended questions')
  })
})

export type ResumeProfile = z.infer<typeof resumeProfileSchema>

/**
 * Voluntary self-identification.
 *
 * Kept OUT of `ResumeProfile` and retained only for existing local database
 * compatibility. The answer pipeline never reads these values: it uses an
 * advertised decline option or leaves a sensitive field unanswered.
 */
export const eeoAnswersSchema = z.object({
  gender: z.string().nullable(),
  race_ethnicity: z.string().nullable(),
  veteran_status: z.string().nullable(),
  disability_status: z.string().nullable(),
  hispanic_or_latino: z.string().nullable()
})

export type EeoAnswers = z.infer<typeof eeoAnswersSchema>

export const emptyEeo: EeoAnswers = {
  gender: null,
  race_ethnicity: null,
  veteran_status: null,
  disability_status: null,
  hispanic_or_latino: null
}

/** A minimal valid profile, used as the fallback when structuring fails. */
export function emptyProfile(name: string, email = ''): ResumeProfile {
  const parts = name.trim().split(/\s+/)
  return {
    personal: {
      full_name: name,
      first_name: parts[0] ?? '',
      last_name: parts.slice(1).join(' '),
      email,
      phone: null,
      headline: null,
      pronouns: null
    },
    location: {
      line1: null,
      line2: null,
      city: null,
      region: null,
      postal_code: null,
      country_code: null,
      country_name: null
    },
    links: [],
    work_experience: [],
    education: [],
    skills: [],
    languages: [],
    certifications: [],
    work_authorization: {
      authorized_country_codes: [],
      requires_sponsorship: null,
      notice_period_days: null
    },
    preferences: {
      desired_salary: null,
      salary_currency: null,
      willing_to_relocate: null,
      remote_preference: null,
      earliest_start_date: null
    },
    about: {
      summary: '',
      motivation: '',
      strengths: [],
      notable_projects: [],
      freeform_notes: ''
    }
  }
}

/**
 * Coerce whatever a model returned into a canonical `YYYY-MM`.
 * Accepts `2021`, `2021-3`, `2021-03-15`, `03/2021`, `March 2021`.
 * Returns null if there is no recoverable year.
 */
export function normalizeYearMonth(input: string | null | undefined): string | null {
  if (!input) return null
  const text = String(input).trim()
  if (!text || /^(present|current|now|ongoing)$/i.test(text)) return null

  const iso = text.match(/^(\d{4})(?:-(\d{1,2}))?(?:-\d{1,2})?$/)
  if (iso) {
    const month = iso[2] ? Math.min(Math.max(Number(iso[2]), 1), 12) : 1
    return `${iso[1]}-${String(month).padStart(2, '0')}`
  }

  const slash = text.match(/^(\d{1,2})[/-](\d{4})$/)
  if (slash) {
    const month = Math.min(Math.max(Number(slash[1]), 1), 12)
    return `${slash[2]}-${String(month).padStart(2, '0')}`
  }

  const MONTHS = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
  ]
  const named = text.match(/^([a-z]+)\.?\s+(\d{4})$/i)
  if (named) {
    const index = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase())
    if (index >= 0) return `${named[2]}-${String(index + 1).padStart(2, '0')}`
  }

  const yearOnly = text.match(/(\d{4})/)
  return yearOnly ? `${yearOnly[1]}-01` : null
}

/**
 * Apply the invariants the schema describes but a model will not reliably
 * honour: normalised dates, and `end_date === null` whenever `is_current`.
 *
 * That second rule matters — Jobo rejects a non-null end_date on a current
 * entry with `current_end_date`, and fixing it here costs nothing while fixing
 * it later costs one of only three correction rounds.
 */
export function normalizeProfile(profile: ResumeProfile): ResumeProfile {
  return {
    ...profile,
    work_experience: profile.work_experience.map((item) => ({
      ...item,
      start_date: normalizeYearMonth(item.start_date) ?? item.start_date,
      end_date: item.is_current ? null : normalizeYearMonth(item.end_date)
    })),
    education: profile.education.map((item) => ({
      ...item,
      start_date: normalizeYearMonth(item.start_date),
      end_date: item.is_current ? null : normalizeYearMonth(item.end_date)
    })),
    certifications: profile.certifications.map((item) => ({
      ...item,
      issued: normalizeYearMonth(item.issued)
    }))
  }
}
