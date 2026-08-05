import type { Answer, AnswerCommand, CommandError, Field } from '@jobo-ai/autoapply'
import { log } from '@/lib/logger'
import { coerceValue } from './coerce'
import { asItemField } from './item-field'
import { runDeterministic } from './deterministic'
import { generateAnswers, type LlmGap } from './llm'
import { slotValue } from './schema'
import { validateCommand } from './validate'
import type { AnswerContext, AnswerTrace, BuildResult } from './types'

/**
 * The answer pipeline:
 *
 *     deterministic  →  LLM (one call)  →  coerce  →  validate  →  repair  →  decide
 *
 * Ordering is the whole design. The deterministic pass runs first and needs no
 * network, so an LLM timeout degrades to "fewer answers" rather than "no
 * answers". Validation runs before we respond, because the correction limit is
 * 3 and a round spent learning something we could have checked locally is a
 * round wasted.
 */

/** Values below this are treated as a skip. */
const MIN_CONFIDENCE = 0.25

/** Jobo caps the callback response at 1 MiB; stay clear of the edge. */
const MAX_RESPONSE_BYTES = 900_000

export async function buildCommand(
  fields: Field[],
  ctx: AnswerContext
): Promise<{ command: AnswerCommand; result: BuildResult }> {
  const trace: AnswerTrace[] = []
  const fieldMap = new Map(fields.map((f) => [f.field_id, f]))
  const values = new Map<string, unknown>()

  // ── 1. Deterministic ──────────────────────────────────────────────────────
  const deterministic = runDeterministic(fields, ctx)

  for (const [fieldId, resolved] of deterministic.resolved) {
    values.set(fieldId, resolved.value)
    const field = fieldMap.get(fieldId)
    trace.push({
      field_id: fieldId,
      label: field?.label ?? fieldId,
      type: field?.type ?? 'unknown',
      source: resolved.rule.startsWith('sensitive:') ? 'declined' : 'deterministic',
      rule: resolved.rule,
      value: resolved.value
    })
  }

  for (const [fieldId, reason] of deterministic.declined) {
    const field = fieldMap.get(fieldId)
    trace.push({
      field_id: fieldId,
      label: field?.label ?? fieldId,
      type: field?.type ?? 'unknown',
      source: 'declined',
      reason
    })
  }

  // ── 2. Carry forward previously accepted answers ──────────────────────────
  // A correction round re-sends the FULL field list, and the response must be a
  // complete snapshot rather than a delta. Re-seeding the answers that were not
  // rejected keeps corrections cheap: only the genuinely broken fields reach
  // the model again.
  const rejectedIds = new Set(
    ctx.commandErrors.map((e) => e.field_id).filter((id): id is string => Boolean(id))
  )
  if (ctx.correctionRound > 0) {
    for (const previous of ctx.previousAnswers) {
      if (rejectedIds.has(previous.field_id)) continue
      if (values.has(previous.field_id)) continue
      if (!fieldMap.has(previous.field_id)) continue
      values.set(previous.field_id, previous.value)
      const field = fieldMap.get(previous.field_id)
      trace.push({
        field_id: previous.field_id,
        label: field?.label ?? previous.field_id,
        type: field?.type ?? 'unknown',
        source: 'previous_round',
        value: previous.value
      })
    }
  }

  // ── 3. What is left for the model ─────────────────────────────────────────
  const pending = fields.filter((field) => {
    if (field.type === 'unknown') return false
    if (field.sensitive) return false // never sent to a model
    if (deterministic.declined.has(field.field_id)) return false
    if (!values.has(field.field_id)) return true
    // A field the last round rejected must be re-answered even if we have a
    // deterministic value for it — that value is what just got rejected.
    return rejectedIds.has(field.field_id)
  })

  const gaps: LlmGap[] = []
  for (const [syntheticId, gap] of deterministic.groupGaps) {
    const items = deterministic.groupItems.get(gap.field.field_id) ?? []
    gaps.push({
      syntheticId,
      field: gap.field,
      index: gap.index,
      key: gap.key,
      itemField: gap.itemField,
      groupLabel: gap.field.label,
      item: items[gap.index] ?? {}
    })
  }

  let llmModel: string | undefined
  let llmMs: number | undefined
  let llmError: string | undefined

  if ((pending.length > 0 || gaps.length > 0) && ctx.budgetMs > 1_000) {
    try {
      const generated = await generateAnswers(pending, gaps, ctx)
      llmModel = generated.model
      llmMs = generated.elapsedMs

      // 3a. Ordinary fields.
      for (const field of pending) {
        const answer = generated.answers.get(field.field_id)
        if (!answer) continue
        if (answer.kind === 'skip' || answer.confidence < MIN_CONFIDENCE) {
          trace.push({
            field_id: field.field_id,
            label: field.label,
            type: field.type,
            source: 'dropped',
            reasoning: answer.reasoning,
            confidence: answer.confidence,
            reason: answer.kind === 'skip' ? 'model declined to answer' : 'confidence below threshold'
          })
          continue
        }

        const raw = slotValue(answer)
        const value = raw === undefined ? undefined : coerceValue(raw as never, field)
        if (value === undefined) {
          trace.push({
            field_id: field.field_id,
            label: field.label,
            type: field.type,
            source: 'dropped',
            reasoning: answer.reasoning,
            confidence: answer.confidence,
            reason: `could not coerce ${JSON.stringify(raw)?.slice(0, 80)} to a ${field.type} value`
          })
          continue
        }

        values.set(field.field_id, value)
        trace.push({
          field_id: field.field_id,
          label: field.label,
          type: field.type,
          source: 'llm',
          reasoning: answer.reasoning,
          confidence: answer.confidence,
          value
        })
      }

      // 3b. Group gaps, written back into the item they came from.
      for (const gap of gaps) {
        const answer = generated.answers.get(gap.syntheticId)
        if (!answer || answer.kind === 'skip') continue
        const raw = slotValue(answer)
        if (raw === undefined) continue

        const value = coerceValue(raw as never, asItemField(gap.field, gap.itemField))
        if (value === undefined) continue

        const items = values.get(gap.field.field_id)
        if (Array.isArray(items) && items[gap.index]) {
          ;(items[gap.index] as Record<string, unknown>)[gap.key] = value
        }
      }
    } catch (error) {
      // Not fatal. The deterministic pass already produced answers, and a
      // partial proceed may still be valid. If it is not, the unanswerable
      // check below turns this into a clean cancel.
      llmError = error instanceof Error ? error.message : String(error)
      log.warn({ err: error, budgetMs: ctx.budgetMs }, 'answer generation failed; using deterministic answers only')
    }
  } else if (pending.length > 0 && ctx.budgetMs <= 1_000) {
    llmError = `no budget left for generation (${ctx.budgetMs}ms)`
    log.warn({ budgetMs: ctx.budgetMs, pending: pending.length }, 'skipping LLM: deadline too close')
  }

  // ── 4. Validate, then repair once ─────────────────────────────────────────
  let answers = toAnswers(values)
  let errors = validateCommand({ action: 'proceed', answers }, fields)

  if (errors.length > 0) {
    const repaired = repair(values, errors, fieldMap, trace)
    if (repaired) {
      answers = toAnswers(values)
      errors = validateCommand({ action: 'proceed', answers }, fields)
    }
  }

  // Anything still invalid is dropped rather than sent. A field we omit gets a
  // clean `required` error at worst; a field we send broken can produce several.
  if (errors.length > 0) {
    for (const error of errors) {
      if (!error.field_id) continue
      if (error.code === 'required' && !values.has(error.field_id)) continue
      if (values.delete(error.field_id)) {
        const field = fieldMap.get(error.field_id)
        trace.push({
          field_id: error.field_id,
          label: field?.label ?? error.field_id,
          type: field?.type ?? 'unknown',
          source: 'dropped',
          reason: `failed local validation: ${error.code} — ${error.message}`
        })
      }
    }
    answers = toAnswers(values)
  }

  // ── 5. Decide ─────────────────────────────────────────────────────────────
  const unanswerable = fields.filter((f) => f.requires_answer && !values.has(f.field_id))

  const result: BuildResult = { answers, trace, unanswerable, llmModel, llmMs, llmError }

  if (unanswerable.length > 0) {
    // A clean cancel beats an incomplete proceed. Proceeding without a required
    // answer spends one of only three correction rounds to be told something we
    // already know, and the application is no closer to being submitted.
    log.warn(
      { unanswerable: unanswerable.map((f) => ({ id: f.field_id, label: f.label })) },
      'canceling: required fields could not be answered'
    )
    return { command: { action: 'cancel' }, result }
  }

  return { command: enforceSizeLimit({ action: 'proceed', answers }, trace), result }
}

function toAnswers(values: Map<string, unknown>): Answer[] {
  return [...values].map(([field_id, value]) => ({ field_id, value }))
}

/**
 * Mechanically fix what can be fixed.
 *
 * Most validation failures are shape problems, not knowledge problems: a length
 * overrun, "yes" where a boolean belongs, a label where an option value
 * belongs, a year where a month is required. Re-running coercion fixes those
 * for free. Anything that needs new information is left for the correction
 * round.
 */
function repair(
  values: Map<string, unknown>,
  errors: CommandError[],
  fieldMap: Map<string, Field>,
  trace: AnswerTrace[]
): boolean {
  const REPAIRABLE = new Set([
    'invalid_type',
    'invalid_option',
    'invalid_date',
    'date_precision',
    'max_length',
    'minimum',
    'maximum',
    'max_items',
    'invalid_typeahead'
  ])

  let changed = false

  for (const error of errors) {
    if (!error.field_id || !REPAIRABLE.has(error.code)) continue
    // Group repairs need per-item surgery; leave them to the correction round.
    if (error.item_index !== null) continue

    const field = fieldMap.get(error.field_id)
    const current = values.get(error.field_id)
    if (!field || current === undefined) continue

    const repaired = coerceValue(current as never, field)
    if (repaired === undefined || JSON.stringify(repaired) === JSON.stringify(current)) continue

    values.set(error.field_id, repaired)
    changed = true
    trace.push({
      field_id: error.field_id,
      label: field.label,
      type: field.type,
      source: 'repaired',
      repaired_from: current,
      value: repaired,
      reason: `local ${error.code}`
    })
  }

  return changed
}

/**
 * Keep the response under Jobo's 1 MiB cap.
 * Realistically only reachable via a 10-item repeating group with long
 * descriptions, so trimming the longest free-text values is enough.
 */
function enforceSizeLimit(command: AnswerCommand, trace: AnswerTrace[]): AnswerCommand {
  if (command.action !== 'proceed') return command
  if (Buffer.byteLength(JSON.stringify(command)) <= MAX_RESPONSE_BYTES) return command

  const answers = command.answers.map((answer) => {
    if (typeof answer.value === 'string' && answer.value.length > 2_000) {
      trace.push({
        field_id: answer.field_id,
        label: answer.field_id,
        type: 'text',
        source: 'repaired',
        reason: 'truncated to keep the response under the 1 MiB cap'
      })
      return { ...answer, value: answer.value.slice(0, 2_000) }
    }
    return answer
  })

  return { action: 'proceed', answers }
}
