import type { Answer, CommandError, Field } from '@jobo-ai/autoapply'
import { log } from '@/lib/logger'
import { coerceValue } from './coerce'
import { asItemField } from './item-field'
import { runDeterministic } from './deterministic'
import { generateAnswers, type LlmGap } from './llm'
import { slotValue } from './schema'
import type { AnswerContext, AnswerTrace, BuildResult } from './types'

/**
 * The answer pipeline:
 *
 *     deterministic  →  LLM (one call)  →  coerce  →  decide
 *
 * Ordering is the whole design. The deterministic pass runs first and needs no
 * network, so an LLM timeout degrades to "fewer answers" rather than "no
 * answers".
 *
 * There is no local validation pass, because the server validates for FREE:
 * submitAnswers checks every value synchronously before anything touches the
 * employer's form, and a bad answer is an immediate 400 with per-field errors —
 * no correction round consumed, nothing lost. `repairAnswers` below turns that
 * 400 into a mechanical fix-and-retry.
 */

/** Values below this are treated as a skip. */
const MIN_CONFIDENCE = 0.25

export async function buildAnswers(
  fields: Field[],
  ctx: AnswerContext
): Promise<BuildResult> {
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
  // A correction round re-sends the FULL field list, and the submission must be
  // a complete snapshot rather than a delta. Re-seeding the answers the ATS did
  // not reject keeps corrections cheap: only the genuinely broken fields reach
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
    // A field the ATS rejected last round must be re-answered even if we have
    // a deterministic value for it — that value is what just got rejected.
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
      // partial submission may still be valid. If it is not, the unanswerable
      // check below turns this into a clean cancel.
      llmError = error instanceof Error ? error.message : String(error)
      log.warn({ err: error, budgetMs: ctx.budgetMs }, 'answer generation failed; using deterministic answers only')
    }
  } else if (pending.length > 0 && ctx.budgetMs <= 1_000) {
    llmError = `no budget left for generation (${ctx.budgetMs}ms)`
    log.warn({ budgetMs: ctx.budgetMs, pending: pending.length }, 'skipping LLM: deadline too close')
  }

  // ── 4. Decide ─────────────────────────────────────────────────────────────
  const answers = toAnswers(values)
  const unanswerable = fields.filter((f) => f.requires_answer && !values.has(f.field_id))

  if (unanswerable.length > 0) {
    // The caller cancels rather than submitting an incomplete snapshot: the
    // server would refuse it with per-field `required` errors — free, but no
    // closer to submitted, and the step deadline keeps running meanwhile.
    log.warn(
      { unanswerable: unanswerable.map((f) => ({ id: f.field_id, label: f.label })) },
      'required fields could not be answered'
    )
  }

  return { answers, trace, unanswerable, llmModel, llmMs, llmError }
}

function toAnswers(values: Map<string, unknown>): Answer[] {
  return [...values].map(([field_id, value]) => ({ field_id, value }))
}

/**
 * Mechanically fix what a validation 400 says is broken.
 *
 * Most validation failures are shape problems, not knowledge problems: a length
 * overrun, "yes" where a boolean belongs, a label where an option value
 * belongs, a year where a month is required. Re-running coercion fixes those
 * for free — and the 400 itself cost nothing, because the server validates
 * before anything touches the employer's form. Anything that needs new
 * information is dropped (unless required) rather than resent broken.
 *
 * Returns the repaired snapshot, or null when nothing could be changed — in
 * which case retrying is pointless and the caller should cancel.
 */
export function repairAnswers(
  answers: Answer[],
  errors: CommandError[],
  fields: Field[],
  trace: AnswerTrace[]
): Answer[] | null {
  const REPAIRABLE = new Set([
    'invalid_type',
    'invalid_option',
    'invalid_date',
    'date_precision',
    'min_length',
    'max_length',
    'minimum',
    'maximum',
    'max_items',
    'invalid_typeahead',
    'pattern'
  ])

  const fieldMap = new Map(fields.map((f) => [f.field_id, f]))
  const values = new Map(answers.map((a) => [a.field_id, a.value]))
  let changed = false

  for (const error of errors) {
    if (!error.field_id) continue
    const field = fieldMap.get(error.field_id)
    const current = values.get(error.field_id)

    // Group errors need per-item surgery; coercion works on whole values. Drop
    // the item's broken key when we can, otherwise leave the group for a
    // correction round.
    if (error.item_index !== null) continue

    if (field && current !== undefined && REPAIRABLE.has(error.code)) {
      const repaired = coerceValue(current as never, field)
      if (repaired !== undefined && JSON.stringify(repaired) !== JSON.stringify(current)) {
        values.set(error.field_id, repaired)
        changed = true
        trace.push({
          field_id: error.field_id,
          label: field.label,
          type: field.type,
          source: 'repaired',
          repaired_from: current,
          value: repaired,
          reason: `server ${error.code}`
        })
        continue
      }
    }

    // Could not repair. Withdrawing the answer is safe for optional fields —
    // the server treats a missing optional answer as "leave it alone" — and
    // strictly better than resubmitting a value we know it will refuse.
    if (current !== undefined && field && !field.requires_answer && error.code !== 'required') {
      values.delete(error.field_id)
      changed = true
      trace.push({
        field_id: error.field_id,
        label: field.label,
        type: field.type,
        source: 'dropped',
        repaired_from: current,
        reason: `withdrawn after server ${error.code}: ${error.message}`
      })
    }
  }

  return changed ? toAnswers(values) : null
}
