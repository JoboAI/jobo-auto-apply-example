import type { AnswerCommand, CommandError, Field, FieldOption, GroupItemField } from '@jobo-ai/autoapply'
import { asItemField } from './item-field'

/**
 * A local mirror of Jobo's server-side answer validator.
 *
 * Why bother re-implementing a validation the server already performs?
 * Because **the correction limit is 3**. Send an invalid answer and Jobo
 * re-issues the callback with `command_errors` and increments
 * `correction_round`; on the fourth failure the application dies with
 * `correction_limit_exceeded`. Every error caught here is a round you keep.
 *
 * This is a deliberately faithful port — same codes, same messages, same edge
 * cases — of AutoApplyAnswerValidator.cs in the Jobo backend. When the contract
 * moves, this file is what needs to move with it.
 */

const SUPPORTED_GROUP_TYPES = new Set([
  'education',
  'work_experience',
  'website',
  'language',
  'skill',
  'other'
])

const PARTIAL_DATE_RE = /^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/
const FULL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function error(
  errors: CommandError[],
  fieldId: string | null,
  code: string,
  message: string,
  itemIndex: number | null = null,
  fieldKey: string | null = null
) {
  errors.push({ field_id: fieldId, item_index: itemIndex, field_key: fieldKey, code, message })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function constraintInt(field: Pick<Field, 'constraints'>, key: string): number | null {
  const value = field.constraints?.[key]
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function constraintNumber(field: Pick<Field, 'constraints'>, key: string): number | null {
  const value = field.constraints?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function constraintString(field: Pick<Field, 'constraints'>, key: string): string | null {
  const value = field.constraints?.[key]
  return typeof value === 'string' ? value : null
}

function constraintStrings(field: Pick<Field, 'constraints'>, key: string): string[] {
  const value = field.constraints?.[key]
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  return []
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, and a real calendar day. */
export function isRealPartialDate(value: unknown): value is string {
  if (typeof value !== 'string' || !PARTIAL_DATE_RE.test(value)) return false
  const parts = value.split('-')
  const year = Number(parts[0])
  if (!Number.isInteger(year) || year < 1 || year > 9999) return false
  if (parts.length === 1) return true
  const month = Number(parts[1])
  if (month < 1 || month > 12) return false
  if (parts.length === 2) return true
  const day = Number(parts[2])
  return day >= 1 && day <= daysInMonth(year, month)
}

export function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string' || !FULL_DATE_RE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (month < 1 || month > 12) return false
  return day >= 1 && day <= daysInMonth(year, month)
}

/** `application/pdf` vs `application/*`. Case-insensitive, `/*` suffix only. */
export function mimeMatches(actual: string, accepted: string): boolean {
  const pattern = accepted.trim()
  if (pattern.endsWith('/*')) {
    return actual.toLowerCase().startsWith(pattern.slice(0, -1).toLowerCase())
  }
  return actual.toLowerCase() === pattern.toLowerCase()
}

function validateStringConstraints(
  value: string,
  field: Field,
  errors: CommandError[],
  index: number | null,
  key: string | null
) {
  const min = constraintInt(field, 'min_length')
  if (min !== null && value.length < min) {
    error(errors, field.field_id, 'min_length', `The value must contain at least ${min} characters.`, index, key)
  }
  const max = constraintInt(field, 'max_length')
  if (max !== null && value.length > max) {
    error(errors, field.field_id, 'max_length', `The value must contain at most ${max} characters.`, index, key)
  }
  const pattern = constraintString(field, 'pattern')
  if (pattern) {
    try {
      if (!new RegExp(pattern).test(value)) {
        error(errors, field.field_id, 'pattern', 'The value does not match the advertised pattern.', index, key)
      }
    } catch {
      // A provider can advertise a pattern that is not valid in this regex
      // dialect. The server reports that as a constraint problem, not as the
      // answer being wrong.
      error(errors, field.field_id, 'invalid_constraint', 'The provider advertised an invalid pattern.', index, key)
    }
  }
}

function validateNumberConstraints(
  value: number,
  field: Field,
  errors: CommandError[],
  index: number | null,
  key: string | null
) {
  const min = constraintNumber(field, 'min')
  if (min !== null && value < min) {
    error(errors, field.field_id, 'minimum', `The value must be at least ${min}.`, index, key)
  }
  const max = constraintNumber(field, 'max')
  if (max !== null && value > max) {
    error(errors, field.field_id, 'maximum', `The value must be at most ${max}.`, index, key)
  }
}

function validateOption(
  value: unknown,
  field: Field,
  errors: CommandError[],
  index: number | null,
  key: string | null
) {
  if (typeof value !== 'string') {
    error(errors, field.field_id, 'invalid_type', 'Expected an option value string.', index, key)
    return
  }
  // Note the ordering: an unadvertised value is reported as invalid_option even
  // when it is empty. Only an empty value that IS advertised (or a field with no
  // advertised options at all) falls through to the required check.
  if (field.options?.length > 0 && !field.options.some((o) => o.value === value)) {
    error(errors, field.field_id, 'invalid_option', 'The value is not one of the advertised options.', index, key)
  } else if ((field.required || field.requires_answer) && value === '') {
    error(errors, field.field_id, 'required', 'A required option value cannot be empty.', index, key)
  }
}

function validateTypeahead(
  value: unknown,
  field: Field,
  errors: CommandError[],
  index: number | null,
  key: string | null
) {
  if (
    !isPlainObject(value) ||
    typeof value.query !== 'string' ||
    !isPlainObject(value.selection) ||
    typeof value.selection.value !== 'string' ||
    typeof value.selection.label !== 'string'
  ) {
    error(errors, field.field_id, 'invalid_typeahead', 'Expected {query, selection:{value,label}}.', index, key)
    return
  }
  const selection = value.selection as { value: string; label: string }
  if (!value.query.trim() || !selection.value.trim() || !selection.label.trim()) {
    error(errors, field.field_id, 'required', 'Typeahead query and selection values cannot be empty.', index, key)
    return
  }
  if (field.options?.length > 0 && !field.options.some((o) => o.value === selection.value)) {
    error(errors, field.field_id, 'invalid_option', 'The selected typeahead value is not advertised.', index, key)
  }
}

function validateFile(
  value: unknown,
  field: Field,
  errors: CommandError[],
  index: number | null,
  key: string | null
) {
  let url: URL | null = null
  if (isPlainObject(value) && typeof value.url === 'string') {
    try {
      url = new URL(value.url)
    } catch {
      url = null
    }
  }
  if (
    !isPlainObject(value) ||
    !url ||
    url.protocol !== 'https:' ||
    typeof value.filename !== 'string' ||
    !value.filename.trim()
  ) {
    error(errors, field.field_id, 'invalid_file', 'Expected a signed HTTPS url and a filename.', index, key)
    return
  }
  if ('content_type' in value && value.content_type !== undefined && typeof value.content_type !== 'string') {
    error(errors, field.field_id, 'invalid_file', 'content_type must be a string when supplied.', index, key)
    return
  }
  const accepted = constraintStrings(field, 'accepted_file_types')
  if (accepted.length > 0 && typeof value.content_type === 'string') {
    if (!accepted.some((pattern) => mimeMatches(value.content_type as string, pattern))) {
      error(errors, field.field_id, 'invalid_file_type', 'The file content_type is not accepted by this field.', index, key)
    }
  }
}

/**
 * The server deduplicates group items by a *logical* fingerprint, not by deep
 * equality: two education entries at the same school with the same degree and
 * start date collide even if every other key differs.
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
      if (isPlainObject(value) && isPlainObject(value.selection) && 'value' in value.selection) {
        value = (value.selection as { value: unknown }).value
      }
      const rendered = typeof value === 'string' ? value.trim().toLowerCase() : JSON.stringify(value)
      return `${name}:${rendered}`
    })
    .join('|')
}

function validateGroup(value: unknown, field: Field, errors: CommandError[]) {
  if (!Array.isArray(value)) {
    error(errors, field.field_id, 'invalid_type', 'Expected an array of group items.')
    return
  }
  if (!field.group_type || !SUPPORTED_GROUP_TYPES.has(field.group_type)) {
    error(errors, field.field_id, 'unsupported_group', 'The repeating group type is unsupported.')
  }

  // 10 is a hard platform cap regardless of what the field advertises.
  const min = Math.max(0, field.min_items ?? (field.required ? 1 : 0))
  const max = Math.min(10, field.max_items ?? 10)
  if (value.length < min || value.length > max) {
    error(errors, field.field_id, 'item_count', `Expected between ${min} and ${max} items.`)
  }

  const known = new Set((field.item_fields ?? []).map((f) => f.key))
  const fingerprints = new Set<string>()

  value.forEach((item, i) => {
    if (!isPlainObject(item)) {
      error(errors, field.field_id, 'invalid_item', 'Each group item must be an object.', i)
      return
    }

    const fingerprint = logicalFingerprint(field.group_type, item)
    if (fingerprints.has(fingerprint)) {
      error(errors, field.field_id, 'duplicate_item', 'Duplicate group items are not allowed.', i)
    }
    fingerprints.add(fingerprint)

    for (const key of Object.keys(item)) {
      if (!known.has(key)) {
        error(errors, field.field_id, 'unknown_item_field', 'The group item contains an unadvertised field.', i, key)
      }
    }

    const isCurrent = item.is_current === true

    for (const child of field.item_fields ?? []) {
      if (!(child.key in item)) {
        if (child.required) {
          error(errors, field.field_id, 'required', 'A required group field is missing.', i, child.key)
        }
        continue
      }
      const childValue = item[child.key]
      if (childValue === null) {
        // A null end_date on a current role is the correct answer, not a gap.
        if (child.required && !(isCurrent && child.key === 'end_date')) {
          error(errors, field.field_id, 'required', 'A required group field cannot be null.', i, child.key)
        }
        continue
      }
      validateValue(childValue, asItemField(field, child), errors, i, child.key)
    }

    if (isCurrent && item.end_date !== undefined && item.end_date !== null && item.end_date !== '') {
      error(errors, field.field_id, 'current_end_date', 'end_date must be null when is_current is true.', i, 'end_date')
    }
  })
}


function validateValue(
  value: unknown,
  field: Field,
  errors: CommandError[],
  itemIndex: number | null,
  fieldKey: string | null
) {
  switch (field.type) {
    case 'text':
    case 'textarea': {
      if (typeof value !== 'string') {
        error(errors, field.field_id, 'invalid_type', 'Expected a string.', itemIndex, fieldKey)
        break
      }
      if ((field.required || field.requires_answer) && !value.trim()) {
        error(errors, field.field_id, 'required', 'A required string cannot be empty.', itemIndex, fieldKey)
      }
      validateStringConstraints(value, field, errors, itemIndex, fieldKey)
      break
    }

    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        error(errors, field.field_id, 'invalid_type', 'Expected a JSON number.', itemIndex, fieldKey)
        break
      }
      validateNumberConstraints(value, field, errors, itemIndex, fieldKey)
      break
    }

    case 'checkbox':
      if (typeof value !== 'boolean') {
        error(errors, field.field_id, 'invalid_type', 'Expected a boolean.', itemIndex, fieldKey)
      }
      break

    case 'select':
    case 'radio':
      validateOption(value, field, errors, itemIndex, fieldKey)
      break

    case 'multi_select': {
      if (!Array.isArray(value)) {
        error(errors, field.field_id, 'invalid_type', 'Expected an array of option values.', itemIndex, fieldKey)
        break
      }
      for (const item of value) validateOption(item, field, errors, itemIndex, fieldKey)
      if ((field.required || field.requires_answer) && value.length === 0) {
        error(errors, field.field_id, 'required', 'At least one option is required.', itemIndex, fieldKey)
      }
      const min = constraintInt(field, 'min_items')
      if (min !== null && value.length < min) {
        error(errors, field.field_id, 'min_items', `At least ${min} values are required.`, itemIndex, fieldKey)
      }
      const max = constraintInt(field, 'max_items')
      if (max !== null && value.length > max) {
        error(errors, field.field_id, 'max_items', `At most ${max} values are allowed.`, itemIndex, fieldKey)
      }
      break
    }

    case 'date':
      if (!isRealDate(value)) {
        error(errors, field.field_id, 'invalid_date', 'Expected YYYY-MM-DD.', itemIndex, fieldKey)
      }
      break

    case 'partial_date': {
      if (!isRealPartialDate(value)) {
        error(errors, field.field_id, 'invalid_date', 'Expected YYYY, YYYY-MM, or YYYY-MM-DD.', itemIndex, fieldKey)
        break
      }
      const precision = constraintString(field, 'minimum_precision')
      if (precision) {
        const parts = value.split('-').length
        if ((precision === 'month' && parts < 2) || (precision === 'day' && parts < 3)) {
          error(errors, field.field_id, 'date_precision', `The date requires ${precision} precision.`, itemIndex, fieldKey)
        }
      }
      break
    }

    case 'typeahead':
      validateTypeahead(value, field, errors, itemIndex, fieldKey)
      break

    case 'file':
      validateFile(value, field, errors, itemIndex, fieldKey)
      break

    case 'repeating_group':
      validateGroup(value, field, errors)
      break

    case 'unknown':
      // Unanswerable by contract. Only an error if Jobo insists on an answer.
      if (field.requires_answer) {
        error(errors, field.field_id, 'unsupported_field', 'This required field type is unsupported.', itemIndex, fieldKey)
      }
      break

    default: {
      // Unreachable against the SDK's Field union — which is the point: adding
      // a field type to the SDK makes `field` stop being `never` here and the
      // compiler points at this line. Kept for runtime, because the server can
      // ship a new field type before the SDK knows about it.
      const unknownField = field as { field_id: string; type: string }
      error(errors, unknownField.field_id, 'unsupported_field', `Unsupported field type '${unknownField.type}'.`, itemIndex, fieldKey)
      break
    }
  }
}

/**
 * Validate a command exactly as Jobo will. An empty array means it will be
 * accepted.
 */
export function validateCommand(command: AnswerCommand, fields: Field[]): CommandError[] {
  const errors: CommandError[] = []

  if (command.action === 'cancel') {
    // `answers` must be genuinely ABSENT, not empty. `{action:'cancel',
    // answers: []}` is rejected — which is why AnswerCommand is a
    // discriminated union rather than an object with an optional array.
    if ('answers' in command) {
      error(errors, null, 'answers_not_allowed', 'cancel must not contain the answers property.')
    }
    return errors
  }

  if (command.action !== 'proceed') {
    // Note: this one is fatal rather than correctable — the server fails the
    // application immediately with `callback_invalid_command`.
    error(errors, null, 'invalid_action', 'action must be proceed or cancel.')
    return errors
  }

  const answers = command.answers ?? []

  const seen = new Map<string, number>()
  for (const answer of answers) {
    seen.set(answer.field_id, (seen.get(answer.field_id) ?? 0) + 1)
  }
  for (const [fieldId, count] of seen) {
    if (count > 1) {
      error(errors, fieldId, 'duplicate_answer', 'Each field_id may appear only once.')
    }
  }

  const fieldMap = new Map(fields.map((f) => [f.field_id, f]))
  for (const answer of answers) {
    const field = fieldMap.get(answer.field_id)
    if (!field) {
      error(errors, answer.field_id, 'unknown_field', 'The field does not belong to this callback event.')
      continue
    }
    validateValue(answer.value, field, errors, null, null)
  }

  const supplied = new Set(answers.map((a) => a.field_id))
  for (const field of fields) {
    if (field.requires_answer && !supplied.has(field.field_id)) {
      error(errors, field.field_id, 'required', 'An answer is required.')
    }
  }

  return errors
}

export type { FieldOption }
