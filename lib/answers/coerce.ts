import type { Field } from '@jobo-ai/autoapply'
import { matchBooleanOption, matchOption } from './options'
import { normalizeYearMonth } from '@/lib/resume/profile-schema'

/**
 * Turn a loosely-typed value into the exact wire shape a field expects.
 *
 * Two callers rely on this:
 *
 *  - the LLM path, where the model returns a "typed slot" (a string, a number,
 *    a boolean, ...) that has to become the right JSON shape for the field;
 *  - the repair pass, which re-runs coercion over values the local validator
 *    rejected, fixing the mechanical failures before spending a correction
 *    round on them.
 *
 * Returns `undefined` when there is no defensible coercion. Undefined means
 * "leave this unanswered", which is always better than a value we know is
 * wrong.
 */

export type CoercionInput = string | number | boolean | string[] | Record<string, unknown> | null

// Date shape checks, mirroring the server's rules (real calendar days only).
const PARTIAL_DATE_RE = /^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/
const FULL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

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

function clampLength(value: string, field: Field): string {
  const max = field.constraints?.max_length
  if (typeof max === 'number' && Number.isInteger(max) && value.length > max) {
    // Cut at a word boundary where we can, so a truncated answer still reads
    // like a sentence rather than stopping mid-word.
    const slice = value.slice(0, max)
    const lastSpace = slice.lastIndexOf(' ')
    return lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice
  }
  return value
}

function toBoolean(value: CoercionInput): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    if (['true', 'yes', 'y', '1', 'checked', 'on'].includes(text)) return true
    if (['false', 'no', 'n', '0', 'unchecked', 'off'].includes(text)) return false
  }
  return undefined
}

function toNumber(value: CoercionInput): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    // Strip currency symbols, thousands separators and stray units — models
    // routinely answer "$120,000" to a numeric salary field.
    const cleaned = value.replace(/[^0-9.\-]/g, '')
    if (cleaned && cleaned !== '-' && cleaned !== '.') {
      const parsed = Number(cleaned)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return undefined
}

function clampNumber(value: number, field: Field): number {
  const min = field.constraints?.min
  const max = field.constraints?.max
  let result = value
  if (typeof min === 'number' && result < min) result = min
  if (typeof max === 'number' && result > max) result = max
  return result
}

/** Reduce or extend a partial date to satisfy `minimum_precision`. */
function coercePartialDate(value: CoercionInput, field: Field): string | undefined {
  if (typeof value !== 'string') return undefined
  let text = value.trim()

  if (!isRealPartialDate(text)) {
    const normalized = normalizeYearMonth(text)
    if (!normalized) return undefined
    text = normalized
  }

  const precision = field.constraints?.minimum_precision
  const parts = text.split('-')
  if (precision === 'month' && parts.length < 2) return `${parts[0]}-01`
  if (precision === 'day') {
    if (parts.length === 1) return `${parts[0]}-01-01`
    if (parts.length === 2) return `${parts[0]}-${parts[1]}-01`
  }
  return text
}

function coerceDate(value: CoercionInput): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (isRealDate(text)) return text

  // Accept YYYY-MM and pad to the first of the month; accept a parseable date
  // string and reduce it to a UTC calendar day.
  if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`
  if (/^\d{4}$/.test(text)) return `${text}-01-01`
  const parsed = Date.parse(text)
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10)
  return undefined
}

/**
 * Coerce `value` into the wire shape for `field`.
 * `undefined` means "no defensible answer" — leave the field alone.
 */
export function coerceValue(value: CoercionInput, field: Field): unknown | undefined {
  if (value === null || value === undefined) return undefined

  switch (field.type) {
    case 'text':
    case 'textarea': {
      const text =
        typeof value === 'string'
          ? value
          : typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : Array.isArray(value)
              ? value.join(', ')
              : undefined
      if (text === undefined) return undefined
      const trimmed = clampLength(text.trim(), field)
      return trimmed.length > 0 ? trimmed : undefined
    }

    case 'number': {
      const parsed = toNumber(value)
      return parsed === undefined ? undefined : clampNumber(parsed, field)
    }

    case 'checkbox':
      return toBoolean(value)

    case 'select':
    case 'radio': {
      // Always answer with an advertised option `value`, never a label and
      // never the model's paraphrase of one.
      if (field.options?.length > 0) {
        const candidates =
          typeof value === 'boolean'
            ? undefined
            : Array.isArray(value)
              ? value
              : [String(value)]
        const matched = candidates
          ? matchOption(field.options, candidates)
          : matchBooleanOption(field.options, value as boolean)
        return matched?.value
      }
      return typeof value === 'string' ? value : undefined
    }

    case 'multi_select': {
      const candidates = Array.isArray(value)
        ? value.map(String)
        : typeof value === 'string'
          ? value.split(',').map((part) => part.trim())
          : []
      if (candidates.length === 0) return undefined

      const resolved: string[] = []
      for (const candidate of candidates) {
        const matched =
          field.options?.length > 0 ? matchOption(field.options, [candidate]) : undefined
        const next = matched ? matched.value : field.options?.length > 0 ? undefined : candidate
        if (next && !resolved.includes(next)) resolved.push(next)
      }
      if (resolved.length === 0) return undefined

      const max = field.constraints?.max_items
      return typeof max === 'number' ? resolved.slice(0, max) : resolved
    }

    case 'date':
      return coerceDate(value)

    case 'partial_date':
      return coercePartialDate(value, field)

    case 'typeahead': {
      // The model may hand back either a bare string or a partial object.
      if (typeof value === 'object' && !Array.isArray(value)) {
        const record = value as Record<string, unknown>
        const selection = record.selection as Record<string, unknown> | undefined
        const rawValue = (selection?.value ?? record.value) as string | undefined
        const rawLabel = (selection?.label ?? record.label ?? rawValue) as string | undefined
        const query = (record.query as string | undefined) ?? rawLabel ?? rawValue
        if (!rawValue || !rawLabel || !query) return undefined
        const matched =
          field.options?.length > 0 ? matchOption(field.options, [rawValue, rawLabel]) : undefined
        const selected = matched ?? { value: rawValue, label: rawLabel }
        return { query: String(query), selection: selected }
      }
      if (typeof value === 'string' && value.trim()) {
        const matched =
          field.options?.length > 0 ? matchOption(field.options, [value]) : undefined
        if (matched) return { query: matched.label, selection: matched }
        // With no advertised options, the free-text query IS the selection.
        if (!field.options || field.options.length === 0) {
          return { query: value.trim(), selection: { value: value.trim(), label: value.trim() } }
        }
      }
      return undefined
    }

    case 'file':
      // Never produced by coercion — the resume URL is assembled by the
      // deterministic pass, which is the only thing that knows how to sign it.
      return undefined

    case 'repeating_group':
      // Likewise built structurally, in deterministic.ts.
      return Array.isArray(value) ? value : undefined

    case 'unknown':
    default:
      return undefined
  }
}
