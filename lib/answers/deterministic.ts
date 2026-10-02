import type {
  Field,
  FileValue,
  GroupItemField,
  RepeatingGroupField,
} from '@jobo-ai/autoapply'
import type { AnswerContext } from './types'
import {
  ageInYears,
  currentRole,
  educationByRecency,
  experienceByRecency,
  fullName,
  isStudying,
  jobTypeOptions,
  labelOf,
  workSetupOptions,
  yearMonth,
  type Degree,
  type ResumeProfile,
} from '@/lib/resume/profile-schema'
import {
  fieldOptions,
  groupItemOptions,
  matchBooleanOption,
  matchOption,
  normalize,
} from './options'
import { coerceValue } from './coerce'
import { asItemField } from './item-field'
import { resolveSensitive } from './eeo'

/**
 * Everything that can be answered from the profile without asking a model.
 *
 * This pass runs first, costs nothing, and never fails. It matters for three
 * reasons: it is exact where a model is merely likely (nobody should let an LLM
 * retype an email address), it is instant, and it means a timeout on the LLM
 * call still leaves us with a usable answer set rather than nothing.
 */

export interface ResolvedAnswer {
  value: unknown
  rule: string
}

/** `undefined` means "defer to the LLM". */
type Resolver = (field: Field, ctx: AnswerContext) => unknown | undefined

interface Rule {
  id: string
  match: (field: Field) => boolean
  resolve: Resolver
}

/**
 * Match only stable form identity: the provider field id and visible label.
 * Both raw and normalized spellings are checked so provider ids such as
 * `first_name` and labels such as `First name` share the same rule.
 */
function named(...patterns: RegExp[]) {
  return (field: Field) => {
    const values = [
      field.field_id.toLowerCase(),
      field.label.toLowerCase(),
      normalize(field.field_id),
      normalize(field.label),
    ]
    return patterns.some((pattern) =>
      values.some((value) => pattern.test(value)),
    )
  }
}

const EU_QUESTION = /\b(eu|european union)\b/
const EU_COUNTRIES = new Set(
  'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' '),
)

function linkOf(
  profile: ResumeProfile,
  type: keyof ResumeProfile['links'],
): string | undefined {
  return profile.links[type] ?? undefined
}

const LINK_LABELS: Record<keyof ResumeProfile['links'], string> = {
  linkedin: 'LinkedIn',
  github: 'GitHub',
  portfolio: 'Portfolio',
  other: 'Other',
}

/**
 * Several spellings of one degree, most specific first. The first one that
 * matches an advertised option wins; with no options, the first is the text.
 */
const DEGREE_CANDIDATES: Record<Degree, string[]> = {
  bachelors: ["Bachelor's Degree", "Bachelor's", 'Bachelors', 'Bachelor'],
  ba: ['Bachelor of Arts', 'BA', "Bachelor's Degree", "Bachelor's"],
  bs: ['Bachelor of Science', 'BS', 'BSc', "Bachelor's Degree", "Bachelor's"],
  bfa: ['Bachelor of Fine Arts', 'BFA', "Bachelor's Degree", "Bachelor's"],
  bba: ['Bachelor of Business Administration', 'BBA', "Bachelor's Degree", "Bachelor's"],
  masters: ["Master's Degree", "Master's", 'Masters', 'Master'],
  ma: ['Master of Arts', 'MA', "Master's Degree", "Master's"],
  ms: ['Master of Science', 'MS', 'MSc', "Master's Degree", "Master's"],
  mfa: ['Master of Fine Arts', 'MFA', "Master's Degree", "Master's"],
  meng: ['Master of Engineering', 'MEng', "Master's Degree", "Master's"],
  mba: ['Master of Business Administration', 'MBA', "Master's Degree", "Master's"],
  phd: ['Doctor of Philosophy', 'PhD', 'Ph.D.', 'Doctorate', 'Doctoral Degree'],
  pharmd: ['Doctor of Pharmacy', 'PharmD', 'Doctorate'],
  jd: ['Juris Doctor', 'JD', 'J.D.', 'Doctorate'],
  md: ['Doctor of Medicine', 'MD', 'M.D.', 'Doctorate'],
  do: ['Doctor of Osteopathic Medicine', 'DO', 'Doctorate'],
  dds: ['Doctor of Dental Surgery', 'DDS', 'Doctorate'],
  dvm: ['Doctor of Veterinary Medicine', 'DVM', 'Doctorate'],
  associates: ["Associate's Degree", "Associate's", 'Associate'],
  aa: ['Associate of Arts', 'AA', "Associate's Degree", "Associate's"],
  as: ['Associate of Science', 'AS', "Associate's Degree", "Associate's"],
  bootcamp: ['Bootcamp', 'Certificate'],
  certification: ['Certification', 'Certificate'],
  incomplete: ['No Degree', 'Some College', 'Incomplete'],
}

/** A group cell with several acceptable spellings — see buildGroup. */
class Candidates {
  constructor(readonly values: string[]) {}
}

export function degreeCandidates(degree: Degree): string[] {
  return DEGREE_CANDIDATES[degree]
}

function fullAddress(profile: ResumeProfile): string | undefined {
  const parts = [
    profile.location.address,
    profile.location.address_2,
    profile.location.address_3,
    profile.location.city,
    profile.location.region,
    profile.location.postal_code,
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : undefined
}

/**
 * The resume, as a `file` field value.
 *
 * Jobo downloads this URL itself while the step is open, so it must be a
 * public HTTPS URL on port 443 — see lib/signed-url.ts and the note in
 * .env.example about why localhost can never work here. When no public origin
 * is configured (`ctx.resumeUrl` is null) file fields are declined before the
 * rules run — see runDeterministic below.
 */
function resumeFile(field: Field, ctx: AnswerContext): FileValue | undefined {
  if (!ctx.resumeUrl) return undefined
  const accepted = field.constraints?.accepted_file_types
  const patterns = Array.isArray(accepted)
    ? accepted.filter((a): a is string => typeof a === 'string')
    : typeof accepted === 'string'
      ? [accepted]
      : []

  // If the field advertises accepted types and PDF is not among them, sending
  // it anyway earns `invalid_file_type`. Better to leave it and let the
  // unanswerable check decide.
  if (patterns.length > 0) {
    const ok = patterns.some((pattern) =>
      pattern.trim().endsWith('/*')
        ? ctx.resumeContentType
            .toLowerCase()
            .startsWith(pattern.trim().slice(0, -1).toLowerCase())
        : ctx.resumeContentType.toLowerCase() === pattern.trim().toLowerCase(),
    )
    if (!ok) return undefined
  }

  return {
    url: ctx.resumeUrl,
    filename: ctx.resumeFilename,
    content_type: ctx.resumeContentType,
  }
}

/**
 * The server deduplicates group items by a *logical* fingerprint, not by deep
 * equality: two education entries at the same school with the same degree and
 * start date collide even if every other key differs. Mirrored here so the
 * built group never contains a pair the server would reject as duplicate_item.
 */
export function logicalFingerprint(
  groupType: string | null,
  item: Record<string, unknown>,
): string {
  const preferred: string[] =
    groupType === 'education'
      ? ['school', 'degree', 'field_of_study', 'start_date']
      : groupType === 'work_experience'
        ? ['company', 'title', 'start_date']
        : groupType === 'website'
          ? ['url', 'type']
          : groupType === 'language'
            ? ['language', 'name']
            : groupType === 'skill'
              ? ['skill', 'name']
              : []

  let selected = preferred.filter(
    (name) => item[name] !== undefined && item[name] !== null,
  )
  if (selected.length === 0) selected = Object.keys(item).sort()

  return selected
    .slice()
    .sort()
    .map((name) => {
      let value = item[name]
      // A typeahead value is compared by its selected option value, so the same
      // school typed two different ways still collides.
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        typeof (value as Record<string, unknown>).selection === 'object' &&
        (value as Record<string, unknown>).selection !== null &&
        'value' in
          ((value as Record<string, unknown>).selection as Record<
            string,
            unknown
          >)
      ) {
        value = (
          (value as Record<string, unknown>).selection as { value: unknown }
        ).value
      }
      const rendered =
        typeof value === 'string'
          ? value.trim().toLowerCase()
          : JSON.stringify(value)
      return `${name}:${rendered}`
    })
    .join('|')
}

// ─── Repeating groups ───────────────────────────────────────────────────────

const PLATFORM_MAX_GROUP_ITEMS = 100

/** Source rows for a group type, most recent first. */
function groupRows(
  field: RepeatingGroupField,
  profile: ResumeProfile,
): Record<string, unknown>[] {
  switch (field.group_type) {
    case 'work_experience':
      return experienceByRecency(profile).map((row) => {
        const type = labelOf(jobTypeOptions, row.type)
        return {
          company: row.company,
          title: row.title,
          role: row.title,
          position: row.title,
          employer: row.company,
          employment_type: type,
          type,
          location: row.location,
          start_date: yearMonth(row.start_year, row.start_month),
          end_date: row.currently_working
            ? null
            : yearMonth(row.end_year, row.end_month),
          is_current: row.currently_working,
          current: row.currently_working,
          description: row.description,
          summary: row.description,
        }
      })

    case 'education':
      return educationByRecency(profile).map((row) => {
        const current = isStudying(row)
        const degree = new Candidates(DEGREE_CANDIDATES[row.degree])
        return {
          school: row.school,
          institution: row.school,
          university: row.school,
          degree,
          degree_type: degree,
          field_of_study: row.major,
          major: row.major,
          discipline: row.major,
          start_date: yearMonth(row.start_year, row.start_month),
          end_date: current ? null : yearMonth(row.grad_year, row.grad_month),
          graduation_date: yearMonth(row.grad_year, row.grad_month),
          is_current: current,
          current,
          grade: row.gpa,
          gpa: row.gpa,
        }
      })

    case 'website':
      return (Object.keys(LINK_LABELS) as (keyof ResumeProfile['links'])[])
        .filter((type) => profile.links[type])
        .map((type) => ({
          url: profile.links[type],
          type,
          label: LINK_LABELS[type],
          name: LINK_LABELS[type],
        }))

    case 'language':
      return profile.languages.map((name) => ({ language: name, name }))

    case 'skill':
      return profile.skills.map((row) => ({
        skill: row.name,
        name: row.name,
        years: row.years,
        years_of_experience: row.years,
      }))

    default:
      // `certification` has no home in this profile (Simplify keeps none
      // either), and `other` is provider-specific by definition.
      return []
  }
}

export interface GroupBuildResult {
  items: Record<string, unknown>[]
  /** `${itemIndex}.${key}` for item fields we could not fill. */
  gaps: { index: number; key: string; itemField: GroupItemField }[]
}

/**
 * Assemble a repeating group from the profile.
 *
 * The fiddly parts are all rules rather than judgement, which is exactly why
 * this is deterministic: emit only keys the field advertises (anything else is
 * `unknown_item_field`), null out `end_date` on current roles
 * (`current_end_date`), respect the provider limit and 100-item platform cap
 * (`item_count`), and dedupe on the server's own logical fingerprint
 * (`duplicate_item`).
 */
export function buildGroup(
  field: RepeatingGroupField,
  ctx: AnswerContext,
): GroupBuildResult | undefined {
  const rows = groupRows(field, ctx.profile)
  if (rows.length === 0) return undefined

  const advertised = field.item_fields ?? []
  if (advertised.length === 0) return undefined

  const max = Math.min(
    field.max_items ?? PLATFORM_MAX_GROUP_ITEMS,
    PLATFORM_MAX_GROUP_ITEMS,
  )
  const items: Record<string, unknown>[] = []
  const gaps: GroupBuildResult['gaps'] = []
  const fingerprints = new Set<string>()

  for (const row of rows) {
    if (items.length >= max) break

    const item: Record<string, unknown> = {}
    const pending: GroupItemField[] = []
    const isCurrent = row.is_current === true

    for (const itemField of advertised) {
      let raw = row[itemField.key]
      if (raw instanceof Candidates) {
        const options = groupItemOptions(itemField)
        raw = options.length
          ? matchOption(options, raw.values)?.value
          : raw.values[0]
      }

      if (itemField.key === 'end_date' && isCurrent) {
        // Explicitly null, not omitted: the server treats a null end_date on a
        // current entry as correct, and an omitted required key as missing.
        item.end_date = null
        continue
      }

      if (raw === undefined || raw === null || raw === '') {
        if (itemField.required) pending.push(itemField)
        continue
      }

      if (itemField.type === 'checkbox') {
        item[itemField.key] = raw === true
        continue
      }

      const coerced = coerceValue(raw as never, asItemField(field, itemField))

      if (coerced !== undefined) item[itemField.key] = coerced
      else if (itemField.required) pending.push(itemField)
    }

    if (Object.keys(item).length === 0) continue

    const fingerprint = logicalFingerprint(field.group_type, item)
    if (fingerprints.has(fingerprint)) continue
    fingerprints.add(fingerprint)

    const index = items.length
    items.push(item)
    for (const itemField of pending)
      gaps.push({ index, key: itemField.key, itemField })
  }

  if (items.length === 0) return undefined

  const min = Math.max(0, field.min_items ?? (field.required ? 1 : 0))
  if (items.length < min) return undefined

  return { items, gaps }
}

// ─── The rule list ──────────────────────────────────────────────────────────

/**
 * Ordered by specificity. The first rule whose `match` returns true wins, so
 * narrow rules must precede broad ones. Adding support for a new ATS field is
 * usually one entry here.
 */
const RULES: Rule[] = [
  // Files and groups first — they are matched by type, not by name.
  { id: 'resume_file', match: (f) => f.type === 'file', resolve: resumeFile },
  {
    id: 'repeating_group',
    match: (f) => f.type === 'repeating_group',
    resolve: (f, ctx) =>
      f.type === 'repeating_group' ? buildGroup(f, ctx)?.items : undefined,
  },

  // Identity. "Preferred first name" must precede first_name, which would
  // otherwise claim it.
  {
    id: 'preferred_name',
    match: named(
      /preferred_?(first_?)?name|nick_?name/,
      /preferred (first )?name|nickname|name you go by/,
    ),
    resolve: (_, c) =>
      c.profile.personal.preferred_name ?? c.profile.personal.first_name,
  },
  {
    id: 'first_name',
    match: named(/first_?name$/, /^first name$/),
    resolve: (_, c) => c.profile.personal.first_name,
  },
  {
    id: 'last_name',
    match: named(/last_?name$|surname$/, /^(last name|surname|family name)$/),
    resolve: (_, c) => c.profile.personal.last_name,
  },
  {
    id: 'full_name',
    match: named(/full_?name$|(^|\.)name$/, /^(full name|name|your name)$/),
    resolve: (_, c) => fullName(c.profile),
  },
  {
    id: 'email',
    match: named(/e?_?mail$/, /^e?\s?mail( address)?$/),
    resolve: (_, c) => c.profile.personal.email,
  },
  {
    id: 'phone',
    match: named(/phone|mobile|telephone/),
    resolve: (_, c) => c.profile.personal.phone,
  },
  {
    // Derived from age, never guessed: a missing birthday is declined below.
    id: 'over_18',
    match: named(
      /over_?18|at_?least_?18|18_?years|legal_?age/,
      /\b(18|eighteen) (years|or older)|at least (18|eighteen)|over (18|eighteen)|legal (working )?age/,
    ),
    resolve: (f, c) => {
      const age = ageInYears(c.profile)
      if (age === null) return undefined
      return fieldOptions(f).length
        ? matchBooleanOption(fieldOptions(f), age >= 18)?.value
        : age >= 18
    },
  },
  {
    id: 'birthday',
    match: named(/birth_?(date|day)|date_?of_?birth|(^|_)dob$/, /date of birth|birthday|\bdob\b/),
    resolve: (_, c) => c.profile.personal.birthday,
  },
  {
    // Simplify derives pronouns from gender. Same matching as the sensitive
    // path, so a form that does not flag the field still gets it right.
    id: 'pronouns',
    match: named(/pronoun/),
    resolve: (f, c) => resolveSensitive(f, c.profile).value,
  },
  {
    id: 'current_title',
    match: named(
      /headline|current_?(job_?)?title/,
      /^(headline|current title|current job title|job title|current position)$/,
    ),
    resolve: (_, c) => currentRole(c.profile)?.title,
  },
  {
    id: 'current_company',
    match: named(
      /current_?(company|employer)/,
      /^current (company|employer)( name)?$/,
    ),
    resolve: (_, c) => currentRole(c.profile)?.company,
  },

  // Work authorization — high-stakes, so only answered from explicit profile
  // data. Missing authorization facts are never delegated to a model. Ahead of
  // the location rules: "authorized to work in the country where this job is
  // located?" is not a country field.
  {
    id: 'requires_sponsorship',
    match: named(/sponsor/),
    resolve: (f, c) => {
      const needs = c.profile.work_authorization.requires_sponsorship
      if (needs === null || needs === undefined) return undefined
      return fieldOptions(f).length
        ? matchBooleanOption(fieldOptions(f), needs)?.value
        : needs
    },
  },
  {
    id: 'work_authorized',
    match: named(
      /work_?authoriz|legally_?authoriz|right_?to_?work/,
      /legally authori[sz]ed|authori[sz]ed to work|right to work|eligible to work/,
    ),
    resolve: (f, c) => {
      const authorized = authorizedFor(f, c)
      if (authorized === undefined) return undefined
      return fieldOptions(f).length
        ? matchBooleanOption(fieldOptions(f), authorized)?.value
        : authorized
    },
  },

  // Location
  {
    id: 'country',
    match: named(/country/, /^country$/),
    resolve: (f, c) =>
      fieldOptions(f).length
        ? matchOption(fieldOptions(f), [
            c.profile.location.country_code,
            c.profile.location.country_name,
          ])?.value
        : (c.profile.location.country_name ?? c.profile.location.country_code),
  },
  {
    id: 'region',
    // Whole words only: a bare /state/ also caught "United States" and
    // "statement", and the first matching rule wins.
    match: named(
      /\b(state|province|region|county)\b/,
      /^(state|province|region|county)$/,
    ),
    resolve: (f, c) =>
      fieldOptions(f).length
        ? matchOption(fieldOptions(f), [c.profile.location.region])?.value
        : c.profile.location.region,
  },
  {
    id: 'city',
    // A bare /city/ also caught "ethnicity" and "capacity".
    match: named(/\b(city|locality|town)\b/, /^(city|town)$/),
    resolve: (_, c) => c.profile.location.city,
  },
  {
    id: 'postal_code',
    match: named(/postal|zip/, /^(zip|postal)( code)?$/),
    resolve: (_, c) => c.profile.location.postal_code,
  },
  {
    id: 'address_line1',
    match: named(
      /address\.?line_?1|street/,
      /^(address|street address|address line 1)$/,
    ),
    resolve: (_, c) => c.profile.location.address,
  },
  {
    id: 'address_line2',
    match: named(/address\.?line_?2/, /address line 2/),
    resolve: (_, c) => c.profile.location.address_2,
  },
  {
    id: 'address_line3',
    match: named(/address\.?line_?3/, /address line 3/),
    resolve: (_, c) => c.profile.location.address_3,
  },
  {
    id: 'address_full',
    match: named(/(^|\.)address$/, /^(full address|mailing address)$/),
    resolve: (_, c) => fullAddress(c.profile),
  },

  // Links
  {
    id: 'linkedin',
    match: named(/linkedin/),
    resolve: (_, c) => linkOf(c.profile, 'linkedin'),
  },
  {
    id: 'github',
    match: named(/github/),
    resolve: (_, c) => linkOf(c.profile, 'github'),
  },
  {
    id: 'other_url',
    match: named(/other_?(website|url|link)/, /^other (website|url|link)/),
    resolve: (_, c) => linkOf(c.profile, 'other'),
  },
  {
    id: 'portfolio',
    match: named(
      /portfolio|website|personal_?site/,
      /^(portfolio|website|personal website)$/,
    ),
    resolve: (_, c) =>
      linkOf(c.profile, 'portfolio') ?? linkOf(c.profile, 'other'),
  },

  // Preferences
  {
    id: 'desired_salary',
    match: named(
      /salary|compensation|expected_?pay/,
      /salary|compensation expectation/,
    ),
    resolve: (_, c) => c.profile.preferences.min_salary ?? undefined,
  },
  {
    id: 'work_setup',
    // Preference questions only. "Are you able to work onsite 5 days a
    // week?" is a yes/no commitment for the model, not a preference list.
    match: named(
      /remote_?preference|work_?(setup|arrangement|model)(_?preference)?$/,
      /remote preference|work (setup|arrangement|model|location) preference|preferred (work )?(setup|arrangement|model)/,
    ),
    resolve: (_, c) => labels(workSetupOptions, c.profile.preferences.work_setups),
  },
  {
    id: 'job_type',
    match: named(
      /(desired|preferred)_?(job|employment)_?type/,
      /(desired|preferred) (job|employment|position) type/,
    ),
    resolve: (_, c) => labels(jobTypeOptions, c.profile.preferences.job_types),
  },
  {
    id: 'preferred_locations',
    match: named(
      /(preferred|desired)_?(work_?)?locations?$/,
      /(preferred|desired) (work )?locations?$/,
    ),
    resolve: (_, c) =>
      c.profile.preferences.locations.length
        ? c.profile.preferences.locations
        : undefined,
  },
]

function labels<T extends readonly (readonly [string, string])[]>(
  options: T,
  selected: readonly string[],
): string[] | undefined {
  const result = selected
    .map((value) => labelOf(options, value))
    .filter((label): label is string => Boolean(label))
  return result.length ? result : undefined
}

/** The country a work-authorization question is about. */
function authorizationTarget(field: Field, ctx: AnswerContext): string | undefined {
  const text = normalize(field.label)
  if (EU_QUESTION.test(text)) return 'EU'
  if (/united states|\busa\b|\bu s( a)?\b|\bamerica\b/.test(text) || /\bUS\b/.test(field.label))
    return 'US'
  if (/\bcanad/.test(text)) return 'CA'
  if (/united kingdom|\buk\b|britain|\bengland\b/.test(text)) return 'GB'
  return ctx.jobCountryCode?.toUpperCase()
}

/**
 * Simplify's three yes/no flags for the US, Canada and the UK, plus the
 * candidate's own list for everywhere else. "Authorized to work in the EU?"
 * is about the bloc, not the posting's country: a German citizen may work in
 * the Netherlands.
 */
function authorizedFor(field: Field, ctx: AnswerContext): boolean | undefined {
  const auth = ctx.profile.work_authorization
  const target = authorizationTarget(field, ctx)
  switch (target) {
    case undefined:
      return undefined
    case 'US':
      return auth.us ?? undefined
    case 'CA':
      return auth.canada ?? undefined
    case 'GB':
      return auth.uk ?? undefined
    case 'EU':
      return auth.other_country_codes.some((code) => EU_COUNTRIES.has(code))
    default:
      return auth.other_country_codes.includes(target)
  }
}

export interface DeterministicResult {
  resolved: Map<string, ResolvedAnswer>
  /** Sensitive fields we deliberately declined, with the reason. */
  declined: Map<string, string>
  /** Group gaps to hand to the LLM, keyed by synthetic id. */
  groupGaps: Map<
    string,
    { field: Field; index: number; key: string; itemField: GroupItemField }
  >
  /** Items already built per group field, so gaps can be written back in. */
  groupItems: Map<string, Record<string, unknown>[]>
}

/**
 * Run the deterministic pass over a field list.
 * Anything absent from `resolved` and `declined` is the LLM's problem.
 */
export function runDeterministic(
  fields: Field[],
  ctx: AnswerContext,
): DeterministicResult {
  const resolved = new Map<string, ResolvedAnswer>()
  const declined = new Map<string, string>()
  const groupGaps: DeterministicResult['groupGaps'] = new Map()
  const groupItems: DeterministicResult['groupItems'] = new Map()

  for (const field of fields) {
    // Unanswerable by contract — no rule and no model can help.
    if (field.type === 'unknown') continue

    // A file field needs a public HTTPS URL Jobo can download from. Without
    // PUBLIC_BASE_URL there is nothing to hand over, so record why rather than
    // silently leaving a gap — the trace note is the difference between "the
    // app is broken" and "set PUBLIC_BASE_URL to answer resume fields".
    if (field.type === 'file' && !ctx.resumeUrl) {
      declined.set(
        field.field_id,
        'file field skipped: PUBLIC_BASE_URL is not set, so there is no public HTTPS URL to serve the resume from',
      )
      continue
    }

    if (field.sensitive) {
      const outcome = resolveSensitive(field, ctx.profile)
      if (outcome.value !== undefined) {
        resolved.set(field.field_id, {
          value: outcome.value,
          rule: `sensitive:${outcome.reason}`,
        })
      } else {
        declined.set(field.field_id, outcome.reason)
      }
      continue
    }

    if (field.type === 'repeating_group') {
      const built = buildGroup(field, ctx)
      if (built) {
        resolved.set(field.field_id, {
          value: built.items,
          rule: 'repeating_group',
        })
        groupItems.set(field.field_id, built.items)
        for (const gap of built.gaps) {
          // Synthetic id: the model answers group gaps in the same single call
          // as everything else, and reassembly splits this back apart.
          groupGaps.set(`${field.field_id}#${gap.index}.${gap.key}`, {
            field,
            index: gap.index,
            key: gap.key,
            itemField: gap.itemField,
          })
        }
      }
      continue
    }

    const rule = RULES.find((r) => r.match(field))
    if (!rule) continue

    const raw = rule.resolve(field, ctx)
    if (raw === undefined || raw === null || raw === '') {
      if (rule.id === 'work_authorized' || rule.id === 'requires_sponsorship')
        declined.set(
          field.field_id,
          'Missing explicit work authorization information',
        )
      else if (rule.id === 'over_18')
        declined.set(field.field_id, 'Missing date of birth')
      continue
    }

    // Everything goes through coercion, so a rule can return a natural value
    // (a boolean, a number, a country name) and still produce the exact wire
    // shape the field wants. `file` is the exception: resumeFile() already
    // built the exact {url, filename, content_type} shape, and coercion would
    // only flatten it. (`repeating_group` never reaches here — it is handled
    // and `continue`d above.)
    const value = field.type === 'file' ? raw : coerceValue(raw as never, field)

    if (value !== undefined) {
      resolved.set(field.field_id, { value, rule: rule.id })
    }
  }

  return { resolved, declined, groupGaps, groupItems }
}
