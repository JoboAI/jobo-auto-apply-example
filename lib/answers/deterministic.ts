import type { Field, FileValue, GroupItemField } from '@jobo-ai/autoapply'
import type { AnswerContext } from './types'
import type { ResumeProfile } from '@/lib/resume/profile-schema'
import { findDeclineOption, matchBooleanOption, matchOption, normalize } from './options'
import { coerceValue } from './coerce'
import { asItemField } from './item-field'

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
 * `semantic_key` is provider-driven and the vocabulary grows over time, so
 * match on a pattern rather than equality, and always leave the label heuristic
 * as a fallback rather than failing closed on an unrecognised key.
 */
function sem(pattern: RegExp) {
  return (field: Field) => Boolean(field.semantic_key && pattern.test(field.semantic_key))
}

/** Match on the human label, normalized. The safety net behind semantic_key. */
function label(pattern: RegExp) {
  return (field: Field) => pattern.test(normalize(field.label))
}

function either(...matchers: ((field: Field) => boolean)[]) {
  return (field: Field) => matchers.some((m) => m(field))
}

function linkOf(profile: ResumeProfile, type: string): string | undefined {
  return profile.links.find((link) => link.type === type)?.url
}

function fullAddress(profile: ResumeProfile): string | undefined {
  const parts = [
    profile.location.line1,
    profile.location.line2,
    profile.location.city,
    profile.location.region,
    profile.location.postal_code
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
        ? ctx.resumeContentType.toLowerCase().startsWith(pattern.trim().slice(0, -1).toLowerCase())
        : ctx.resumeContentType.toLowerCase() === pattern.trim().toLowerCase()
    )
    if (!ok) return undefined
  }

  return {
    url: ctx.resumeUrl,
    filename: ctx.resumeFilename,
    content_type: ctx.resumeContentType
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
  item: Record<string, unknown>
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

  let selected = preferred.filter((name) => item[name] !== undefined && item[name] !== null)
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
        'value' in ((value as Record<string, unknown>).selection as Record<string, unknown>)
      ) {
        value = ((value as Record<string, unknown>).selection as { value: unknown }).value
      }
      const rendered = typeof value === 'string' ? value.trim().toLowerCase() : JSON.stringify(value)
      return `${name}:${rendered}`
    })
    .join('|')
}

// ─── Repeating groups ───────────────────────────────────────────────────────

/** Source rows for a group type, most recent first. */
function groupRows(field: Field, profile: ResumeProfile): Record<string, unknown>[] {
  switch (field.group_type) {
    case 'work_experience':
      return [...profile.work_experience]
        .sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? ''))
        .map((row) => ({
          company: row.company,
          title: row.title,
          role: row.title,
          position: row.title,
          employer: row.company,
          employment_type: row.employment_type,
          location: row.location,
          start_date: row.start_date,
          end_date: row.is_current ? null : row.end_date,
          is_current: row.is_current,
          current: row.is_current,
          description: row.description,
          summary: row.description
        }))

    case 'education':
      return [...profile.education]
        .sort((a, b) => (b.end_date ?? b.start_date ?? '').localeCompare(a.end_date ?? a.start_date ?? ''))
        .map((row) => ({
          school: row.school,
          institution: row.school,
          university: row.school,
          degree: row.degree,
          field_of_study: row.field_of_study,
          major: row.field_of_study,
          start_date: row.start_date,
          end_date: row.is_current ? null : row.end_date,
          is_current: row.is_current,
          grade: row.grade,
          gpa: row.grade
        }))

    case 'website':
      return profile.links.map((row) => ({
        url: row.url,
        type: row.type,
        label: row.label,
        name: row.label
      }))

    case 'language':
      return profile.languages.map((row) => ({
        language: row.name,
        name: row.name,
        proficiency: row.proficiency,
        level: row.proficiency
      }))

    case 'skill':
      return profile.skills.map((row) => ({
        skill: row.name,
        name: row.name,
        level: row.level,
        proficiency: row.level
      }))

    default:
      // `other` is provider-specific by definition — no reliable mapping.
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
 * (`current_end_date`), respect the platform cap of 10 (`item_count`), and
 * dedupe on the server's own logical fingerprint (`duplicate_item`).
 */
export function buildGroup(field: Field, ctx: AnswerContext): GroupBuildResult | undefined {
  const rows = groupRows(field, ctx.profile)
  if (rows.length === 0) return undefined

  const advertised = field.item_fields ?? []
  if (advertised.length === 0) return undefined

  const max = Math.min(field.max_items ?? 10, 10)
  const items: Record<string, unknown>[] = []
  const gaps: GroupBuildResult['gaps'] = []
  const fingerprints = new Set<string>()

  for (const row of rows) {
    if (items.length >= max) break

    const item: Record<string, unknown> = {}
    const pending: GroupItemField[] = []
    const isCurrent = row.is_current === true

    for (const itemField of advertised) {
      const raw = row[itemField.key]

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
    for (const itemField of pending) gaps.push({ index, key: itemField.key, itemField })
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
    resolve: (f, ctx) => buildGroup(f, ctx)?.items
  },

  // Identity
  { id: 'first_name', match: either(sem(/first_?name$/), label(/^first name$/)), resolve: (_, c) => c.profile.personal.first_name },
  { id: 'last_name', match: either(sem(/last_?name$|surname$/), label(/^(last name|surname|family name)$/)), resolve: (_, c) => c.profile.personal.last_name },
  { id: 'full_name', match: either(sem(/full_?name$|(^|\.)name$/), label(/^(full name|name|your name)$/)), resolve: (_, c) => c.profile.personal.full_name },
  { id: 'email', match: either(sem(/e?_?mail$/), label(/^e?\s?mail( address)?$/)), resolve: (_, c) => c.profile.personal.email },
  { id: 'phone', match: either(sem(/phone|mobile|telephone/), label(/phone|mobile/)), resolve: (_, c) => c.profile.personal.phone },
  { id: 'pronouns', match: either(sem(/pronoun/), label(/pronoun/)), resolve: (_, c) => c.profile.personal.pronouns },
  { id: 'headline', match: either(sem(/headline|current_?title/), label(/^(headline|current title|job title)$/)), resolve: (_, c) => c.profile.personal.headline },

  // Location
  {
    id: 'country',
    match: either(sem(/country/), label(/^country$/)),
    resolve: (f, c) =>
      f.options?.length
        ? matchOption(f.options, [c.profile.location.country_code, c.profile.location.country_name])?.value
        : (c.profile.location.country_name ?? c.profile.location.country_code)
  },
  {
    id: 'region',
    match: either(sem(/state|province|region/), label(/^(state|province|region|county)$/)),
    resolve: (f, c) =>
      f.options?.length ? matchOption(f.options, [c.profile.location.region])?.value : c.profile.location.region
  },
  { id: 'city', match: either(sem(/city|locality/), label(/^(city|town)$/)), resolve: (_, c) => c.profile.location.city },
  { id: 'postal_code', match: either(sem(/postal|zip/), label(/^(zip|postal)( code)?$/)), resolve: (_, c) => c.profile.location.postal_code },
  { id: 'address_line1', match: either(sem(/address\.?line_?1|street/), label(/^(address|street address|address line 1)$/)), resolve: (_, c) => c.profile.location.line1 },
  { id: 'address_line2', match: sem(/address\.?line_?2/), resolve: (_, c) => c.profile.location.line2 },
  { id: 'address_full', match: either(sem(/(^|\.)address$/), label(/^(full address|mailing address)$/)), resolve: (_, c) => fullAddress(c.profile) },

  // Links
  { id: 'linkedin', match: either(sem(/linkedin/), label(/linkedin/)), resolve: (_, c) => linkOf(c.profile, 'linkedin') },
  { id: 'github', match: either(sem(/github/), label(/github/)), resolve: (_, c) => linkOf(c.profile, 'github') },
  {
    id: 'portfolio',
    match: either(sem(/portfolio|website|personal_?site/), label(/^(portfolio|website|personal website)$/)),
    resolve: (_, c) => linkOf(c.profile, 'portfolio') ?? linkOf(c.profile, 'website')
  },

  // Work authorization — high-stakes, so only answered from explicit profile
  // data. A null in the profile defers to the model rather than guessing.
  {
    id: 'requires_sponsorship',
    match: either(sem(/sponsor/), label(/sponsor/)),
    resolve: (f, c) => {
      const needs = c.profile.work_authorization.requires_sponsorship
      if (needs === null || needs === undefined) return undefined
      return f.options?.length ? matchBooleanOption(f.options, needs)?.value : needs
    }
  },
  {
    id: 'work_authorized',
    match: either(sem(/work_?authoriz|legally_?authoriz|right_?to_?work/), label(/legally authori[sz]ed|authori[sz]ed to work|right to work/)),
    resolve: (f, c) => {
      const codes = c.profile.work_authorization.authorized_country_codes
      if (!codes || codes.length === 0) return undefined
      // Only assert authorization when the posting's country is known and
      // matches. Otherwise this is a question for the model, or for a human.
      const country = c.profile.location.country_code
      const authorized = country ? codes.includes(country) : codes.length > 0
      return f.options?.length ? matchBooleanOption(f.options, authorized)?.value : authorized
    }
  },
  {
    id: 'notice_period',
    match: either(sem(/notice_?period/), label(/notice period/)),
    resolve: (f, c) => {
      const days = c.profile.work_authorization.notice_period_days
      if (days === null || days === undefined) return undefined
      return f.type === 'number' ? days : `${days} days`
    }
  },

  // Preferences
  {
    id: 'desired_salary',
    match: either(sem(/salary|compensation|expected_?pay/), label(/salary|compensation expectation/)),
    resolve: (_, c) => c.profile.preferences.desired_salary ?? undefined
  },
  {
    id: 'willing_to_relocate',
    match: either(sem(/relocat/), label(/relocat/)),
    resolve: (f, c) => {
      const willing = c.profile.preferences.willing_to_relocate
      if (willing === null || willing === undefined) return undefined
      return f.options?.length ? matchBooleanOption(f.options, willing)?.value : willing
    }
  },
  {
    id: 'remote_preference',
    match: either(sem(/remote|work_?location_?preference/), label(/remote preference|work preference/)),
    resolve: (f, c) => {
      const preference = c.profile.preferences.remote_preference
      if (!preference) return undefined
      return f.options?.length ? matchOption(f.options, [preference])?.value : preference
    }
  },
  {
    id: 'start_date',
    match: either(sem(/start_?date|available/), label(/start date|availability|available from/)),
    resolve: (_, c) => c.profile.preferences.earliest_start_date ?? undefined
  }
]

export interface DeterministicResult {
  resolved: Map<string, ResolvedAnswer>
  /** Sensitive fields we deliberately declined, with the reason. */
  declined: Map<string, string>
  /** Group gaps to hand to the LLM, keyed by synthetic id. */
  groupGaps: Map<string, { field: Field; index: number; key: string; itemField: GroupItemField }>
  /** Items already built per group field, so gaps can be written back in. */
  groupItems: Map<string, Record<string, unknown>[]>
}

/**
 * Sensitive fields — voluntary self-identification.
 *
 * Order matters and the policy is deliberate:
 *   1. a value the user explicitly typed into the UI, if there is one;
 *   2. otherwise the form's own "prefer not to say" option;
 *   3. otherwise nothing.
 *
 * These are never sent to the model. Jobo does not infer them either; an
 * example that quietly invented someone's demographic data to get a form
 * submitted would be teaching the wrong lesson.
 */
function resolveSensitive(field: Field, ctx: AnswerContext): { value?: unknown; reason: string } {
  const key = field.semantic_key ?? ''
  const eeo = ctx.eeo

  const stored =
    eeo &&
    (/gender|sex/i.test(key) ? eeo.gender
      : /race|ethnic/i.test(key) ? eeo.race_ethnicity
        : /veteran/i.test(key) ? eeo.veteran_status
          : /disab/i.test(key) ? eeo.disability_status
            : /hispanic|latino/i.test(key) ? eeo.hispanic_or_latino
              : null)

  if (stored) {
    const matched = field.options?.length ? matchOption(field.options, [stored]) : undefined
    if (matched) return { value: matched.value, reason: 'user-provided self-identification' }
    if (!field.options?.length) return { value: stored, reason: 'user-provided self-identification' }
  }

  const decline = findDeclineOption(field.options ?? [])
  if (decline) return { value: decline.value, reason: 'declined to self-identify (no user-provided value)' }

  return { reason: 'sensitive field with no user-provided value and no decline option' }
}

/**
 * Run the deterministic pass over a field list.
 * Anything absent from `resolved` and `declined` is the LLM's problem.
 */
export function runDeterministic(fields: Field[], ctx: AnswerContext): DeterministicResult {
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
        'file field skipped: PUBLIC_BASE_URL is not set, so there is no public HTTPS URL to serve the resume from'
      )
      continue
    }

    if (field.sensitive) {
      const outcome = resolveSensitive(field, ctx)
      if (outcome.value !== undefined) {
        resolved.set(field.field_id, { value: outcome.value, rule: `sensitive:${outcome.reason}` })
      } else {
        declined.set(field.field_id, outcome.reason)
      }
      continue
    }

    if (field.type === 'repeating_group') {
      const built = buildGroup(field, ctx)
      if (built) {
        resolved.set(field.field_id, { value: built.items, rule: 'repeating_group' })
        groupItems.set(field.field_id, built.items)
        for (const gap of built.gaps) {
          // Synthetic id: the model answers group gaps in the same single call
          // as everything else, and reassembly splits this back apart.
          groupGaps.set(`${field.field_id}#${gap.index}.${gap.key}`, {
            field,
            index: gap.index,
            key: gap.key,
            itemField: gap.itemField
          })
        }
      }
      continue
    }

    const rule = RULES.find((r) => r.match(field))
    if (!rule) continue

    const raw = rule.resolve(field, ctx)
    if (raw === undefined || raw === null || raw === '') continue

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
