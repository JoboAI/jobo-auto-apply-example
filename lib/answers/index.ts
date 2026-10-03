import type { Answer, CommandError, Field } from '@jobo-ai/autoapply'
import { log } from '@/lib/logger'
import { OpenRouterError } from '@/lib/openrouter'
import { coerceValue } from './coerce'
import { asItemField } from './item-field'
import { runDeterministic } from './deterministic'
import { generateAnswers, type LlmGap } from './llm'
import { slotValue, type GeneratedAnswer } from './schema'
import type { AnswerContext, AnswerTrace, BuildResult } from './types'

/**
 * The answer pipeline:
 *
 *     deterministic  →  LLM (one call)  →  coerce  →  decide
 *
 * (plus, when the model fumbles a required field, one small retry call for
 * just those fields).
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
/** Trace reasons for a deliberate skip and for a confidence too low to use. */
const MODEL_DECLINED = 'model declined to answer'
const LOW_CONFIDENCE = 'confidence below threshold'
/** Below this much budget, a retry would only time out. */
const MIN_RETRY_BUDGET_MS = 5_000

export async function buildAnswers(fields: Field[], ctx: AnswerContext): Promise<BuildResult> {
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
      value: resolved.value,
    })
  }

  for (const [fieldId, reason] of deterministic.declined) {
    const field = fieldMap.get(fieldId)
    trace.push({
      field_id: fieldId,
      label: field?.label ?? fieldId,
      type: field?.type ?? 'unknown',
      source: 'declined',
      reason,
    })
  }

  // ── 2. Carry forward previously accepted answers ──────────────────────────
  // A correction round re-sends the FULL field list, and the submission must be
  // a complete snapshot rather than a delta. Re-seeding the answers the ATS did
  // not reject keeps corrections cheap: only the genuinely broken fields reach
  // the model again.
  const rejectedIds = new Set(
    ctx.commandErrors.map((e) => e.field_id).filter((id): id is string => Boolean(id)),
  )
  if (ctx.correctionRound > 0) {
    for (const previous of ctx.previousAnswers) {
      if (rejectedIds.has(previous.field_id)) continue
      if (values.has(previous.field_id)) continue
      const field = fieldMap.get(previous.field_id)
      if (!field) continue
      if (field.sensitive) continue
      if (deterministic.declined.has(previous.field_id)) continue
      values.set(previous.field_id, previous.value)
      trace.push({
        field_id: previous.field_id,
        label: field.label,
        type: field.type,
        source: 'previous_round',
        value: previous.value,
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
      item: items[gap.index] ?? {},
    })
  }

  let llmModel: string | undefined
  let llmMs: number | undefined
  let llmError: string | undefined
  let llmFatal = false
  // The model's outcome per ordinary field, written to the trace once both
  // passes are done so a field retried in the second pass appears once.
  const outcomes = new Map<string, AnswerTrace>()
  // Required fields the model was asked about and returned nothing usable for
  // (left out of its output, or a value that would not coerce) — as opposed to
  // a deliberate skip, which means the profile cannot support an answer.
  const modelFailures = new Set<string>()

  if ((pending.length > 0 || gaps.length > 0) && ctx.budgetMs > 1_000) {
    const startedAt = Date.now()
    try {
      const generated = await generateAnswers(pending, gaps, ctx)
      llmModel = generated.model
      llmMs = generated.elapsedMs
      applyGenerated(pending, generated.answers, values, outcomes)

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

      // 3c. One retry for required fields the model fumbled. Across a long
      // form, a model occasionally leaves a field out of its output or fills
      // the wrong slot, and either one would cancel the whole application. A
      // second, much smaller call costs a few seconds of the budget. Fields it
      // deliberately skipped are not retried: asking again only invites it to
      // invent what the profile does not say.
      const fumbled = pending.filter(
        (field) =>
          field.requires_answer &&
          !values.has(field.field_id) &&
          !declined(outcomes.get(field.field_id)),
      )
      const remainingMs = ctx.budgetMs - (Date.now() - startedAt)
      if (fumbled.length > 0 && remainingMs > MIN_RETRY_BUDGET_MS) {
        log.info(
          { fields: fumbled.map((f) => f.label), remainingMs },
          'retrying required fields the model did not answer',
        )
        const retry = await generateAnswers(fumbled, [], { ...ctx, budgetMs: remainingMs })
        llmMs += retry.elapsedMs
        applyGenerated(fumbled, retry.answers, values, outcomes)
      }
    } catch (error) {
      // Not fatal. The deterministic pass already produced answers, and a
      // partial submission may still be valid. If it is not, the unanswerable
      // check below turns this into a clean cancel.
      llmError = error instanceof Error ? error.message : String(error)
      llmFatal = error instanceof OpenRouterError && error.isAuthError
      log.warn(
        { error, budgetMs: ctx.budgetMs },
        'answer generation failed; using deterministic answers only',
      )
    }
    for (const field of pending) {
      const outcome = outcomes.get(field.field_id)
      if (outcome) trace.push(outcome)
      if (
        field.requires_answer &&
        !values.has(field.field_id) &&
        outcome?.source === 'dropped' &&
        !declined(outcome)
      )
        modelFailures.add(field.field_id)
    }
  } else if (pending.length > 0 && ctx.budgetMs <= 1_000) {
    llmError = `no budget left for generation (${ctx.budgetMs}ms)`
    log.warn(
      { budgetMs: ctx.budgetMs, pending: pending.length },
      'skipping LLM: deadline too close',
    )
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
      'required fields could not be answered',
    )
  }

  return {
    answers,
    trace,
    unanswerable,
    modelFailures: unanswerable.filter((f) => modelFailures.has(f.field_id)),
    llmModel,
    llmMs,
    llmError,
    llmFatal,
  }
}

/** True when the model chose not to answer, rather than failing to. */
function declined(outcome: AnswerTrace | undefined) {
  return outcome?.reason === MODEL_DECLINED || outcome?.reason === LOW_CONFIDENCE
}

/**
 * Record the model's answers for `fields` into `values`, and each field's
 * outcome (answered, declined, or dropped and why) into `outcomes`.
 */
function applyGenerated(
  fields: Field[],
  generated: Map<string, GeneratedAnswer>,
  values: Map<string, unknown>,
  outcomes: Map<string, AnswerTrace>,
) {
  for (const field of fields) {
    const base = { field_id: field.field_id, label: field.label, type: field.type }
    const answer = generated.get(field.field_id)
    if (!answer) {
      outcomes.set(field.field_id, {
        ...base,
        source: 'dropped',
        reason: 'model returned no answer for this field',
      })
      continue
    }
    const judged = { reasoning: answer.reasoning, confidence: answer.confidence }
    if (answer.kind === 'skip' || answer.confidence < MIN_CONFIDENCE) {
      outcomes.set(field.field_id, {
        ...base,
        ...judged,
        source: 'dropped',
        reason: answer.kind === 'skip' ? MODEL_DECLINED : LOW_CONFIDENCE,
      })
      continue
    }

    const raw = slotValue(answer)
    const value = raw === undefined ? undefined : coerceValue(raw as never, field)
    if (value === undefined) {
      outcomes.set(field.field_id, {
        ...base,
        ...judged,
        source: 'dropped',
        reason: `could not coerce ${JSON.stringify(raw)?.slice(0, 80)} to a ${field.type} value`,
      })
      continue
    }

    values.set(field.field_id, value)
    outcomes.set(field.field_id, { ...base, ...judged, source: 'llm', value })
  }
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
  trace: AnswerTrace[],
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
    'pattern',
  ])

  const fieldMap = new Map(fields.map((f) => [f.field_id, f]))
  const values = new Map(answers.map((a) => [a.field_id, a.value]))
  let changed = false

  for (const error of errors) {
    if (!error.field_id) continue
    const field = fieldMap.get(error.field_id)
    const current = values.get(error.field_id)

    // Group errors need per-item surgery, and coercion works on whole values,
    // so a repeating-group error is left for the ATS's correction round.
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
          reason: `server ${error.code}`,
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
        reason: `withdrawn after server ${error.code}: ${error.message}`,
      })
    }
  }

  return changed ? toAnswers(values) : null
}
