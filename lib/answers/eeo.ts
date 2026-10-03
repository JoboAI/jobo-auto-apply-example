import type { Field, FieldOption } from '@jobo-ai/autoapply'
import type { Ethnicity, ResumeProfile } from '@/lib/resume/profile-schema'
import { fieldOptions, findDeclineOption, matchBooleanOption, normalize } from './options'

/**
 * Voluntary self-identification (EEO) questions.
 *
 * The candidate answers these once, explicitly, in onboarding: the five
 * standard US self-identification questions. This module maps those answers
 * onto whatever wording a given ATS uses.
 *
 * Three rules hold throughout:
 *
 *  - These answers never reach the model. Matching is by rule only.
 *  - Nothing is inferred. A question we cannot map exactly — or one the
 *    candidate declined — gets the form's own decline option, and with no
 *    decline option the field is left unanswered.
 *  - A narrower question never gets a broader claim. "Yes" to LGBTQ+ does not
 *    pick a sexual orientation; nothing ever answers a transgender question.
 */

export type EeoKind =
  | 'pronouns'
  | 'transgender'
  | 'sexual_orientation'
  | 'lgbtq'
  | 'hispanic'
  | 'race'
  | 'veteran'
  | 'disability'
  | 'gender'

/** Ordered: narrower questions first, so "gender identity" is not "gender". */
const KINDS: [EeoKind, RegExp][] = [
  ['pronouns', /\bpronouns?\b/],
  [
    'transgender',
    /\btrans ?gender\b|\btrans\b|gender identity (is )?(the )?same|assigned at birth/,
  ],
  ['sexual_orientation', /sexual orientation|\bsexuality\b/],
  ['lgbtq', /\blgbt|\bqueer\b/],
  ['veteran', /veteran|military|armed forces|\bservice member/],
  ['disability', /disab/],
  ['race', /\brace\b|racial|ethnic/],
  ['hispanic', /hispanic|latin[aox]?\b|latinx/],
  ['gender', /\bgender\b|\bsex\b/],
]

export function classifyEeo(field: Field): EeoKind | undefined {
  const text = normalize(`${field.label} ${field.field_id}`)
  const hit = KINDS.find(([, pattern]) => pattern.test(text))?.[0]
  // "Are you Hispanic or Latino?" is its own question; "Race/Ethnicity" with a
  // Hispanic option is the race question.
  if (hit === 'race' && /hispanic|latin/.test(text) && !/\brace\b|racial/.test(text))
    return 'hispanic'
  return hit
}

const optionText = (option: FieldOption) => normalize(`${option.label} ${option.value}`)
const NEGATIVE = /\b(not|no|non|none|never)\b|n t /

function find(
  options: readonly FieldOption[],
  test: (text: string) => boolean,
): FieldOption | undefined {
  const decline = findDeclineOption(options)
  return options.find((option) => option !== decline && test(optionText(option)))
}

const affirmative = (pattern: RegExp) => (text: string) =>
  pattern.test(text) && !NEGATIVE.test(text)
const negative = (pattern: RegExp) => (text: string) => pattern.test(text) && NEGATIVE.test(text)

function yesNo(
  options: readonly FieldOption[],
  value: boolean,
  topic: RegExp,
): FieldOption | undefined {
  return (
    matchBooleanOption(options, value) ??
    find(options, value ? affirmative(/^yes\b/) : (t) => /^no\b/.test(t)) ??
    find(options, value ? affirmative(topic) : negative(topic))
  )
}

/** "Hispanic or Latino", but not "White (Not Hispanic or Latino)". */
const HISPANIC_OPTION = /^(?!.*\bnot (hispanic|latin)).*(hispanic|latin)/

const RACE_PATTERNS: Record<Exclude<Ethnicity, 'decline'>, RegExp[]> = {
  black_african_american: [/\bblack\b|african american/],
  east_asian: [/^(?!.*south).*\beast asian\b/, /\basian\b/],
  southeast_asian: [/southeast asian|south east asian/, /\basian\b/],
  south_asian: [/\bsouth asian\b/, /\basian\b/],
  hispanic_latinx: [HISPANIC_OPTION],
  // EEO-1 counts Middle Eastern and North African origins as White when the
  // form has no category of its own.
  middle_eastern: [/middle eastern|\bmena\b|north african/, /\bwhite\b/],
  native_hawaiian_pacific_islander: [/hawaiian|pacific islander/],
  native_american_alaskan: [/american indian|alaska|native american|indigenous|first nations/],
  white: [/\bwhite\b|caucasian/],
}

function raceOption(
  options: readonly FieldOption[],
  value: Exclude<Ethnicity, 'decline'>,
): FieldOption | undefined {
  for (const pattern of RACE_PATTERNS[value]) {
    // "Asian" must not land on "Native Hawaiian or Other Pacific Islander",
    // and no plain race may land on "Two or more races".
    const hit = find(options, (t) => pattern.test(t) && !/two or more|multi/.test(t))
    if (hit) return hit
  }
  return undefined
}

function resolveRace(
  field: Field,
  options: readonly FieldOption[],
  ethnicity: Ethnicity[],
): unknown | undefined {
  // Forms that ask "Hispanic or Latino?" separately leave it out of the race
  // list (the EEO-1 two-question format). Then it is not a race answer.
  const asksHispanicHere = options.some((o) => HISPANIC_OPTION.test(optionText(o)))
  const values = ethnicity.filter(
    (v): v is Exclude<Ethnicity, 'decline'> =>
      v !== 'decline' && (asksHispanicHere || v !== 'hispanic_latinx'),
  )
  if (values.length === 0) return undefined

  const matched: FieldOption[] = []
  for (const value of values) {
    const option = raceOption(options, value)
    if (!option) return undefined // part of the answer has no home: decline
    if (!matched.includes(option)) matched.push(option)
  }

  if (field.type === 'multi_select') return matched.map((o) => o.value)
  if (matched.length === 1) return matched[0].value
  // Single choice, several identities. Under EEO-1, Hispanic or Latino is the
  // answer whenever it applies; otherwise "Two or more races".
  const hispanic = values.includes('hispanic_latinx')
    ? raceOption(options, 'hispanic_latinx')
    : undefined
  if (hispanic) return hispanic.value
  return find(options, (t) => /two or more|multiracial|multiple|mixed/.test(t))?.value
}

/** Pronouns are derived from gender rather than stored. */
export function pronounsFor(gender: ResumeProfile['eeo']['gender']): string | undefined {
  switch (gender) {
    case 'male':
      return 'He/him'
    case 'female':
      return 'She/her'
    case 'non_binary':
      return 'They/them'
    default:
      return undefined
  }
}

/** The answer for a classified question, before any decline fallback. */
function resolveKind(kind: EeoKind, field: Field, eeo: ResumeProfile['eeo']): unknown | undefined {
  const options = fieldOptions(field)
  const hasOptions = options.length > 0
  const asBoolean = (value: boolean, topic: RegExp) =>
    field.type === 'checkbox'
      ? value
      : hasOptions
        ? yesNo(options, value, topic)?.value
        : value
          ? 'Yes'
          : 'No'

  switch (kind) {
    case 'gender': {
      if (!eeo.gender || eeo.gender === 'decline') return undefined
      const pattern = {
        male: /\bmale\b|\bman\b/,
        female: /\bfemale\b|\bwoman\b/,
        non_binary: /non ?binary|genderqueer|gender non conforming/,
      }[eeo.gender]
      if (!hasOptions)
        return { male: 'Male', female: 'Female', non_binary: 'Non-binary' }[eeo.gender]
      return find(options, (t) => pattern.test(t) && !/trans/.test(t))?.value
    }

    case 'pronouns': {
      const pronouns = pronounsFor(eeo.gender)
      if (!pronouns) return undefined
      if (!hasOptions) return pronouns
      const subject = pronouns.split('/')[0].toLowerCase()
      return find(options, (t) => new RegExp(`^${subject}\\b`).test(t))?.value
    }

    case 'veteran': {
      if (!eeo.veteran || eeo.veteran === 'decline') return undefined
      const yes = eeo.veteran === 'yes'
      if (field.type === 'checkbox' || !hasOptions) return asBoolean(yes, /veteran/)
      // Federal forms phrase "yes" as "I identify as one or more of the
      // classifications of protected veteran", which is what "Yes" means here.
      return (
        (yes
          ? find(
              options,
              affirmative(/identify as one or more|protected veteran|i am a veteran|^yes\b/),
            )
          : find(options, negative(/veteran|^no\b/))) ?? yesNo(options, yes, /veteran/)
      )?.value
    }

    case 'disability': {
      if (!eeo.disability || eeo.disability === 'decline') return undefined
      return asBoolean(eeo.disability === 'yes', /disab/)
    }

    case 'lgbtq': {
      if (!eeo.lgbtq || eeo.lgbtq === 'decline') return undefined
      return asBoolean(eeo.lgbtq === 'yes', /lgbt|queer/)
    }

    case 'sexual_orientation': {
      // Only "no" is specific enough to answer: it means heterosexual.
      if (eeo.lgbtq !== 'no') return undefined
      if (!hasOptions) return 'Heterosexual'
      return find(options, (t) => /heterosexual|straight/.test(t))?.value
    }

    case 'hispanic': {
      const ethnicity = eeo.ethnicity
      if (!ethnicity || ethnicity.includes('decline')) return undefined
      return asBoolean(ethnicity.includes('hispanic_latinx'), /hispanic|latin/)
    }

    case 'race': {
      const ethnicity = eeo.ethnicity
      if (!ethnicity || ethnicity.includes('decline') || !hasOptions) return undefined
      return resolveRace(field, options, ethnicity)
    }

    case 'transgender':
      return undefined
  }
}

/**
 * Answer a `sensitive: true` field from the candidate's own self-identification,
 * or decline. Never consults a model.
 */
export function resolveSensitive(
  field: Field,
  profile: ResumeProfile,
): { value?: unknown; reason: string } {
  const kind = classifyEeo(field)
  const value = kind ? resolveKind(kind, field, profile.eeo) : undefined
  if (value !== undefined && value !== null)
    return { value, reason: `${kind} from the candidate's self-identification` }

  const decline = findDeclineOption(fieldOptions(field))
  if (decline) {
    return {
      value: field.type === 'multi_select' ? [decline.value] : decline.value,
      reason: kind
        ? `declined ${kind}: not answered, declined, or no exact option`
        : 'declined to self-identify',
    }
  }
  return { reason: 'sensitive field with no exact answer and no decline option' }
}
