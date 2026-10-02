import { z } from 'zod'

/**
 * The candidate profile.
 *
 * This is the half of Auto Apply that Jobo deliberately does not own. Jobo
 * stores no profile and no resume — it hands you the form's fields and you
 * produce the answers from something like this.
 *
 * The shape follows Simplify.jobs' candidate model, which has been filled into
 * millions of real ATS forms: the same sections, the same option lists, the
 * same habit of deriving rather than storing (full name, pronouns, current
 * title, "are you over 18"). Two departures, both deliberate:
 *
 *  - Simplify's integer enum codes are readable strings here, so the model
 *    and a strict JSON schema both read them without a lookup table.
 *  - Simplify's school / company / major catalogs are free text.
 *
 * Dates are month + year integers, as on Simplify's forms. They become
 * `YYYY-MM` only at answer time (see `yearMonth`), so the stored profile has
 * no date strings for a model to get subtly wrong.
 */

const month = z.number().int().nullable().describe('1-12, or null if unknown')
const year = z.number().int().nullable().describe('Four-digit year, or null if unknown')

/** Simplify's degree list, in its own order. */
export const degreeOptions = [
  ['bachelors', "Bachelor's"],
  ['ba', 'Bachelor of Arts (BA)'],
  ['bs', 'Bachelor of Science (BS)'],
  ['bfa', 'Bachelor of Fine Arts (BFA)'],
  ['bba', 'Bachelor of Business Administration (BBA)'],
  ['masters', "Master's"],
  ['ma', 'Master of Arts (MA)'],
  ['ms', 'Master of Science (MS)'],
  ['mfa', 'Master of Fine Arts (MFA)'],
  ['meng', 'Master of Engineering (MEng)'],
  ['mba', 'Master of Business Administration (MBA)'],
  ['phd', 'Doctor of Philosophy (PhD)'],
  ['pharmd', 'Doctor of Pharmacy (PharmD)'],
  ['jd', 'Juris Doctor (JD)'],
  ['md', 'Doctor of Medicine (MD)'],
  ['do', 'Doctor of Osteopathic Medicine (DO)'],
  ['dds', 'Doctor of Dental Surgery (DDS)'],
  ['dvm', 'Doctor of Veterinary Medicine (DVM)'],
  ['associates', "Associate's"],
  ['aa', 'Associate of Arts (AA)'],
  ['as', 'Associate of Science (AS)'],
  ['bootcamp', 'Bootcamp'],
  ['certification', 'Certification'],
  ['incomplete', 'Incomplete / no degree']
] as const
export type Degree = (typeof degreeOptions)[number][0]
const degrees = degreeOptions.map(([value]) => value) as [Degree, ...Degree[]]

export const jobTypeOptions = [
  ['internship', 'Internship'],
  ['full_time', 'Full-time'],
  ['part_time', 'Part-time'],
  ['contract', 'Contract']
] as const
export type JobType = (typeof jobTypeOptions)[number][0]
const jobTypes = jobTypeOptions.map(([value]) => value) as [JobType, ...JobType[]]

export const skillYearsOptions = [
  ['0-1', '0-1 years'],
  ['2-4', '2-4 years'],
  ['5-8', '5-8 years'],
  ['9+', '9+ years']
] as const
const skillYears = skillYearsOptions.map(([value]) => value) as [string, ...string[]]

export const workSetupOptions = [
  ['remote', 'Remote'],
  ['hybrid', 'Hybrid'],
  ['in_person', 'In-person']
] as const
export type WorkSetup = (typeof workSetupOptions)[number][0]
const workSetups = workSetupOptions.map(([value]) => value) as [WorkSetup, ...WorkSetup[]]

export const genderOptions = [
  ['male', 'Male'],
  ['female', 'Female'],
  ['non_binary', 'Non-binary'],
  ['decline', 'Decline to state']
] as const
export type Gender = (typeof genderOptions)[number][0]

/** Simplify's ethnicity list. `decline` is exclusive — see normalizeProfile. */
export const ethnicityOptions = [
  ['black_african_american', 'Black / African American'],
  ['east_asian', 'East Asian'],
  ['hispanic_latinx', 'Hispanic / Latinx'],
  ['middle_eastern', 'Middle Eastern'],
  ['southeast_asian', 'Southeast Asian'],
  ['south_asian', 'South Asian'],
  ['native_hawaiian_pacific_islander', 'Native Hawaiian / Pacific Islander'],
  ['native_american_alaskan', 'Native American / Alaskan'],
  ['white', 'White'],
  ['decline', 'Decline to state']
] as const
export type Ethnicity = (typeof ethnicityOptions)[number][0]

export const yesNoDeclineOptions = [
  ['yes', 'Yes'],
  ['no', 'No'],
  ['decline', 'Decline to state']
] as const
export type YesNoDecline = (typeof yesNoDeclineOptions)[number][0]

function values<T extends readonly (readonly [string, string])[]>(options: T) {
  return options.map(([value]) => value) as unknown as [T[number][0], ...T[number][0][]]
}

export const resumeProfileSchema = z.object({
  personal: z.object({
    first_name: z.string(),
    last_name: z.string(),
    preferred_name: z.string().nullable().describe('Only if the candidate goes by another first name'),
    email: z.string(),
    phone: z.string().nullable().describe('E.164 where possible, e.g. +14155550123'),
    birthday: z.string().nullable().describe('YYYY-MM-DD, only if explicitly stated')
  }),

  location: z.object({
    address: z.string().nullable().describe('Street address'),
    address_2: z.string().nullable(),
    address_3: z.string().nullable(),
    city: z.string().nullable(),
    region: z.string().nullable().describe('State / province'),
    postal_code: z.string().nullable(),
    country_code: z.string().nullable().describe('ISO 3166-1 alpha-2, e.g. US, GB, NL'),
    country_name: z.string().nullable()
  }),

  links: z.object({
    linkedin: z.string().nullable(),
    github: z.string().nullable(),
    portfolio: z.string().nullable().describe('Personal website or portfolio'),
    other: z.string().nullable().describe('Any other relevant URL')
  }),

  education: z.array(
    z.object({
      school: z.string(),
      degree: z.enum(degrees),
      major: z.string().nullable(),
      gpa: z.number().nullable(),
      start_month: month,
      start_year: year,
      grad_month: month,
      grad_year: year.describe('Expected year if still studying')
    })
  ),

  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      location: z.string().nullable(),
      type: z.enum(jobTypes).nullable(),
      start_month: month,
      start_year: year,
      end_month: month.describe('null when currently_working'),
      end_year: year.describe('null when currently_working'),
      currently_working: z.boolean(),
      description: z.string().describe('What they did and achieved, as "- " bullet lines')
    })
  ),

  projects: z.array(
    z.object({
      name: z.string(),
      title: z.string().nullable().describe('Their role on the project'),
      location: z.string().nullable(),
      start_month: month,
      start_year: year,
      end_month: month,
      end_year: year,
      currently_working: z.boolean(),
      description: z.string(),
      link: z.string().nullable()
    })
  ),

  skills: z.array(
    z.object({
      name: z.string(),
      years: z.enum(skillYears).nullable().describe('Years of experience, only if stated'),
      favorite: z.boolean()
    })
  ),

  languages: z.array(z.string()).describe('Spoken languages, e.g. "English", "Dutch"'),

  work_authorization: z.object({
    us: z.boolean().nullable().describe('Authorized to work in the US'),
    canada: z.boolean().nullable().describe('Authorized to work in Canada'),
    uk: z.boolean().nullable().describe('Authorized to work in the United Kingdom'),
    other_country_codes: z
      .array(z.string())
      .describe('Other ISO alpha-2 codes the candidate can already work in'),
    requires_sponsorship: z
      .boolean()
      .nullable()
      .describe('Will now or in the future require visa sponsorship')
  }),

  eeo: z.object({
    gender: z.enum(values(genderOptions)).nullable(),
    ethnicity: z.array(z.enum(values(ethnicityOptions))).nullable(),
    veteran: z.enum(values(yesNoDeclineOptions)).nullable(),
    disability: z.enum(values(yesNoDeclineOptions)).nullable(),
    lgbtq: z.enum(values(yesNoDeclineOptions)).nullable()
  }),

  preferences: z.object({
    job_types: z.array(z.enum(jobTypes)),
    work_setups: z.array(z.enum(workSetups)),
    locations: z.array(z.string()),
    min_salary: z.number().nullable().describe('Minimum expected annual salary')
  })
})

export type ResumeProfile = z.infer<typeof resumeProfileSchema>
export type EeoAnswers = ResumeProfile['eeo']

/**
 * What a resume can tell us. Work authorization, self-identification and
 * preferences are the candidate's to state, never a parser's to infer.
 */
export const resumeExtractSchema = resumeProfileSchema.omit({
  work_authorization: true,
  eeo: true,
  preferences: true
})

export const emptyWorkAuthorization = (): ResumeProfile['work_authorization'] => ({
  us: null,
  canada: null,
  uk: null,
  other_country_codes: [],
  requires_sponsorship: null
})

export const emptyEeo = (): EeoAnswers => ({
  gender: null,
  ethnicity: null,
  veteran: null,
  disability: null,
  lgbtq: null
})

export const emptyPreferences = (): ResumeProfile['preferences'] => ({
  job_types: [],
  work_setups: [],
  locations: [],
  min_salary: null
})

/** A minimal valid profile, used as the fallback when structuring fails. */
export function emptyProfile(name: string, email = ''): ResumeProfile {
  const parts = name.trim().split(/\s+/)
  return {
    personal: {
      first_name: parts[0] ?? '',
      last_name: parts.slice(1).join(' '),
      preferred_name: null,
      email,
      phone: null,
      birthday: null
    },
    location: {
      address: null,
      address_2: null,
      address_3: null,
      city: null,
      region: null,
      postal_code: null,
      country_code: null,
      country_name: null
    },
    links: { linkedin: null, github: null, portfolio: null, other: null },
    education: [],
    experience: [],
    projects: [],
    skills: [],
    languages: [],
    work_authorization: emptyWorkAuthorization(),
    eeo: emptyEeo(),
    preferences: emptyPreferences()
  }
}

// ─── Derived facts ──────────────────────────────────────────────────────────

export function fullName(profile: ResumeProfile): string {
  return [profile.personal.first_name, profile.personal.last_name]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
}

/** `YYYY-MM`, `YYYY`, or null — the shape partial_date fields want. */
export function yearMonth(y: number | null, m: number | null): string | null {
  if (!y) return null
  return m ? `${y}-${String(m).padStart(2, '0')}` : String(y)
}

/** Sortable key for "most recent first". */
function recency(y: number | null, m: number | null): number {
  return (y ?? 0) * 100 + (m ?? 0)
}

export function experienceByRecency(profile: ResumeProfile) {
  return [...profile.experience].sort(
    (a, b) =>
      Number(b.currently_working) - Number(a.currently_working) ||
      recency(b.end_year ?? b.start_year, b.end_month ?? b.start_month) -
        recency(a.end_year ?? a.start_year, a.end_month ?? a.start_month) ||
      recency(b.start_year, b.start_month) - recency(a.start_year, a.start_month)
  )
}

export function educationByRecency(profile: ResumeProfile) {
  return [...profile.education].sort(
    (a, b) =>
      recency(b.grad_year ?? b.start_year, b.grad_month ?? b.start_month) -
      recency(a.grad_year ?? a.start_year, a.grad_month ?? a.start_month)
  )
}

/** The role a form means by "current company / current title". */
export function currentRole(profile: ResumeProfile) {
  return experienceByRecency(profile)[0]
}

/** An education entry whose graduation is still ahead is current. */
export function isStudying(
  row: ResumeProfile['education'][number],
  now = new Date()
): boolean {
  if (!row.grad_year) return false
  return recency(row.grad_year, row.grad_month ?? 12) >
    recency(now.getUTCFullYear(), now.getUTCMonth() + 1)
}

/** Whole years of age today, or null without a valid birthday. */
export function ageInYears(profile: ResumeProfile, now = new Date()): number | null {
  const match = profile.personal.birthday?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const [, y, m, d] = match.map(Number)
  let age = now.getUTCFullYear() - y
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age -= 1
  return age >= 0 && age < 130 ? age : null
}

export function labelOf<T extends readonly (readonly [string, string])[]>(
  options: T,
  value: string | null | undefined
): string | null {
  return options.find(([key]) => key === value)?.[1] ?? null
}

// ─── Normalisation ──────────────────────────────────────────────────────────

/**
 * Coerce whatever a model returned into a canonical `YYYY-MM`.
 * Accepts `2021`, `2021-3`, `2021-03-15`, `03/2021`, `March 2021`.
 * Returns null if there is no recoverable year. Used by answer coercion.
 */
export function normalizeYearMonth(input: string | null | undefined): string | null {
  if (!input) return null
  const text = String(input).trim()
  if (!text || /^(present|current|now|ongoing)$/i.test(text)) return null

  const iso = text.match(/^(\d{4})(?:-(\d{1,2}))?(?:-\d{1,2})?$/)
  if (iso) {
    const monthValue = iso[2] ? Math.min(Math.max(Number(iso[2]), 1), 12) : 1
    return `${iso[1]}-${String(monthValue).padStart(2, '0')}`
  }

  const slash = text.match(/^(\d{1,2})[/-](\d{4})$/)
  if (slash) {
    const monthValue = Math.min(Math.max(Number(slash[1]), 1), 12)
    return `${slash[2]}-${String(monthValue).padStart(2, '0')}`
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

const cleanMonth = (value: number | null) =>
  value && Number.isInteger(value) && value >= 1 && value <= 12 ? value : null
const cleanYear = (value: number | null) =>
  value && Number.isInteger(value) && value >= 1900 && value <= 2100 ? value : null
const cleanText = (value: string | null) => value?.trim() || null

/**
 * Apply the invariants the schema describes but a model (or a form) will not
 * reliably honour.
 *
 * The one that matters most: no end date on a current role. Jobo rejects a
 * non-null end_date on a current entry with `current_end_date`, and fixing it
 * here costs nothing while fixing it later costs one of three correction rounds.
 */
export function normalizeProfile(profile: ResumeProfile): ResumeProfile {
  const ethnicity = profile.eeo.ethnicity
  return {
    ...profile,
    personal: {
      ...profile.personal,
      first_name: profile.personal.first_name.trim(),
      last_name: profile.personal.last_name.trim(),
      preferred_name: cleanText(profile.personal.preferred_name),
      email: profile.personal.email.trim(),
      phone: cleanText(profile.personal.phone),
      birthday: /^\d{4}-\d{2}-\d{2}$/.test(profile.personal.birthday ?? '')
        ? profile.personal.birthday
        : null
    },
    location: {
      ...profile.location,
      country_code: cleanText(profile.location.country_code)?.toUpperCase() ?? null
    },
    links: {
      linkedin: cleanText(profile.links.linkedin),
      github: cleanText(profile.links.github),
      portfolio: cleanText(profile.links.portfolio),
      other: cleanText(profile.links.other)
    },
    education: profile.education.map((row) => ({
      ...row,
      start_month: cleanMonth(row.start_month),
      start_year: cleanYear(row.start_year),
      grad_month: cleanMonth(row.grad_month),
      grad_year: cleanYear(row.grad_year)
    })),
    experience: profile.experience.map((row) => ({
      ...row,
      start_month: cleanMonth(row.start_month),
      start_year: cleanYear(row.start_year),
      end_month: row.currently_working ? null : cleanMonth(row.end_month),
      end_year: row.currently_working ? null : cleanYear(row.end_year)
    })),
    projects: profile.projects.map((row) => ({
      ...row,
      link: cleanText(row.link),
      start_month: cleanMonth(row.start_month),
      start_year: cleanYear(row.start_year),
      end_month: row.currently_working ? null : cleanMonth(row.end_month),
      end_year: row.currently_working ? null : cleanYear(row.end_year)
    })),
    languages: [...new Set(profile.languages.map((name) => name.trim()).filter(Boolean))],
    work_authorization: {
      ...profile.work_authorization,
      other_country_codes: [
        ...new Set(
          profile.work_authorization.other_country_codes
            .map((code) => code.trim().toUpperCase())
            .filter((code) => /^[A-Z]{2}$/.test(code) && !['US', 'CA', 'GB'].includes(code))
        )
      ]
    },
    eeo: {
      ...profile.eeo,
      // "Decline to state" is exclusive, and an empty selection is unanswered.
      ethnicity: !ethnicity || ethnicity.length === 0
        ? null
        : ethnicity.includes('decline')
          ? ['decline']
          : [...new Set(ethnicity)]
    }
  }
}
