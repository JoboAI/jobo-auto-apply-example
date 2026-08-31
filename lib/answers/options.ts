import type { Field, FieldOption, GroupItemField } from '@jobo-ai/autoapply'

/**
 * Matching a profile value onto an ATS's advertised option list.
 *
 * This is where a surprising share of `invalid_option` errors come from. The
 * profile says `country_code: "US"`; the form offers
 * `{value: "United States", label: "United States"}`. Or the profile says
 * `true` and the form offers `{value: "yes"}`.
 *
 * The rule throughout: return `undefined` rather than guess. An undefined
 * result falls through to the LLM, which gets the full option list and can make
 * a semantic choice. A wrong guess costs a correction round; a deferral costs
 * a few hundred tokens.
 */

/** Lowercase, strip accents, collapse punctuation and whitespace. */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Return advertised options only for field types that may expose them. */
export function fieldOptions(field: Field): readonly FieldOption[] {
  switch (field.type) {
    case 'select':
    case 'multi_select':
    case 'radio':
    case 'typeahead':
      return field.options ?? []
    default:
      return []
  }
}

/** Group-item counterpart to fieldOptions. */
export function groupItemOptions(field: GroupItemField): readonly FieldOption[] {
  switch (field.type) {
    case 'select':
    case 'multi_select':
    case 'radio':
    case 'typeahead':
      return field.options ?? []
    default:
      return []
  }
}

/**
 * Small, high-confidence equivalence classes. Deliberately not a full country
 * or locale database — anything ambiguous should reach the model instead.
 */
const ALIAS_GROUPS: string[][] = [
  ['yes', 'y', 'true', '1'],
  ['no', 'n', 'false', '0'],
  ['prefer not to say', 'prefer not to answer', 'decline to self identify', 'i do not wish to answer', 'choose not to disclose'],
  ['united states', 'united states of america', 'usa', 'us'],
  ['united kingdom', 'uk', 'gb', 'great britain'],
  ['netherlands', 'the netherlands', 'nl', 'holland'],
  ['germany', 'de', 'deutschland'],
  ['canada', 'ca'],
  ['australia', 'au'],
  ['india', 'in'],
  ['ireland', 'ie'],
  ['france', 'fr'],
  ['spain', 'es'],
  ['male', 'man'],
  ['female', 'woman'],
  ['full time', 'fulltime', 'full time employee'],
  ['part time', 'parttime'],
  ['remote', 'fully remote', 'work from home'],
  ['hybrid', 'partially remote'],
  ['onsite', 'on site', 'in office', 'in person']
]

const ALIAS_LOOKUP = new Map<string, number>()
ALIAS_GROUPS.forEach((group, index) => {
  for (const member of group) ALIAS_LOOKUP.set(normalize(member), index)
})

function aliasGroup(value: string): number | undefined {
  return ALIAS_LOOKUP.get(normalize(value))
}

/** True when two strings mean the same thing under our alias table. */
export function equivalent(a: string, b: string): boolean {
  if (normalize(a) === normalize(b)) return true
  const groupA = aliasGroup(a)
  const groupB = aliasGroup(b)
  return groupA !== undefined && groupA === groupB
}

/** Jaccard overlap of word sets. Used only above a high threshold. */
function tokenOverlap(a: string, b: string): number {
  const setA = new Set(normalize(a).split(' ').filter(Boolean))
  const setB = new Set(normalize(b).split(' ').filter(Boolean))
  if (setA.size === 0 || setB.size === 0) return 0
  let shared = 0
  for (const token of setA) if (setB.has(token)) shared += 1
  return shared / new Set([...setA, ...setB]).size
}

/**
 * Find the option that means one of `candidates`.
 *
 * Tried in order of decreasing confidence: exact value, exact label, alias
 * equivalence, then a conservative token-overlap fallback. Returns undefined
 * on no confident match, and also on an ambiguous tie.
 */
export function matchOption(
  options: readonly FieldOption[],
  candidates: readonly (string | null | undefined)[]
): FieldOption | undefined {
  const values = candidates.filter((c): c is string => Boolean(c && String(c).trim()))
  if (options.length === 0 || values.length === 0) return undefined

  for (const candidate of values) {
    const exactValue = options.find((o) => o.value === candidate)
    if (exactValue) return exactValue
  }
  for (const candidate of values) {
    const byNormalizedValue = options.find((o) => normalize(o.value) === normalize(candidate))
    if (byNormalizedValue) return byNormalizedValue
  }
  for (const candidate of values) {
    const byLabel = options.find((o) => normalize(o.label) === normalize(candidate))
    if (byLabel) return byLabel
  }
  for (const candidate of values) {
    const byAlias = options.find((o) => equivalent(o.value, candidate) || equivalent(o.label, candidate))
    if (byAlias) return byAlias
  }

  // Last resort. Require both a high score and a clear winner, so that
  // "Engineering" vs "Engineering Management" does not silently pick one.
  for (const candidate of values) {
    const scored = options
      .map((option) => ({
        option,
        score: Math.max(tokenOverlap(option.label, candidate), tokenOverlap(option.value, candidate))
      }))
      .sort((a, b) => b.score - a.score)

    if (scored.length > 0 && scored[0].score >= 0.75) {
      const runnerUp = scored[1]?.score ?? 0
      if (scored[0].score - runnerUp >= 0.25) return scored[0].option
    }
  }

  return undefined
}

/** Match a boolean onto a yes/no style option list. */
export function matchBooleanOption(
  options: readonly FieldOption[],
  value: boolean
): FieldOption | undefined {
  return matchOption(options, value ? ['yes', 'true'] : ['no', 'false'])
}

/**
 * The "prefer not to say" option, when the form offers one.
 *
 * Used exclusively for `sensitive: true` fields where the user has not supplied
 * an explicit answer. Declining is a real, valid answer that every compliant
 * EEO form offers — it lets the application proceed without this app inventing
 * demographic data about a person.
 */
export function findDeclineOption(options: readonly FieldOption[]): FieldOption | undefined {
  return options.find((option) =>
    /prefer not|decline|do not wish|don't wish|choose not|not disclose|no answer/i.test(
      `${option.label} ${option.value}`
    )
  )
}
