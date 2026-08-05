import type { Field, GroupItemField } from '@jobo-ai/autoapply'
import type { AnswerContext } from './types'

/**
 * Prompt construction for the answer model.
 *
 * The single highest-leverage thing here is *compaction*. A raw `fields[]` from
 * a large ATS form is tens of kilobytes of structure the model does not need,
 * and shipping it whole costs latency (against a 120-second deadline) and
 * accuracy (the relevant details get buried). We project each field down to the
 * keys that actually determine a valid answer.
 */

/** Options beyond this are truncated, with the model told that happened. */
const MAX_OPTIONS = 60
const MAX_RESUME_EXCERPT = 6000

export const SYSTEM_PROMPT = `You fill in job application forms on behalf of a candidate, using only the facts in their profile.

Answer in the first person, as the candidate.

Hard rules:
- NEVER invent employers, job titles, dates, degrees, certifications, salaries, or credentials that are not in the profile. If a fact is not there, use kind:"skip".
- For select, radio, and multi_select fields, return EXACTLY one of the provided option "value" strings — never the label, never a paraphrase, never a new value.
- For a field with options, if none of them fit, use kind:"skip" rather than inventing an option.
- Respect max_length. Keep textarea answers to 3-6 sentences unless max_length says otherwise.
- Never return an empty string for a required field. Use kind:"skip" instead, so the caller can decide.
- Use the "kind" that matches the field type: text/select/radio/date fields -> kind:"text"; number -> kind:"number"; checkbox -> kind:"boolean"; multi_select -> kind:"strings"; typeahead -> kind:"typeahead".
- For date fields use the exact format the field asks for: "YYYY-MM-DD" for date, and "YYYY", "YYYY-MM" or "YYYY-MM-DD" for partial_date.
- Answer every field in fields_to_answer exactly once, including the ones you skip.
- Write open-ended answers that are specific to this candidate's actual experience. Generic filler is worse than a skip.
- Keep "reasoning" to one short sentence naming where the answer came from.`

/** Strip a field down to what determines a valid answer. */
function compactField(field: Field) {
  const options = field.options ?? []
  const truncated = options.length > MAX_OPTIONS

  return {
    field_id: field.field_id,
    type: field.type,
    label: field.label,
    required: field.required || field.requires_answer,
    ...(field.semantic_key ? { semantic_key: field.semantic_key } : {}),
    ...(field.category ? { category: field.category } : {}),
    ...(field.format ? { format: field.format } : {}),
    ...(options.length
      ? {
          options: options.slice(0, MAX_OPTIONS).map((o) => ({ value: o.value, label: o.label })),
          ...(truncated
            ? {
                options_note: `Only the first ${MAX_OPTIONS} of ${options.length} options are shown. If none fit, use kind:"skip".`
              }
            : {})
        }
      : {}),
    ...(field.constraints && Object.keys(field.constraints).length
      ? { constraints: field.constraints }
      : {}),
    ...(field.min_items !== null ? { min_items: field.min_items } : {}),
    ...(field.max_items !== null ? { max_items: field.max_items } : {})
  }
}

/** A group gap, presented as if it were an ordinary field. */
function compactGap(
  syntheticId: string,
  itemField: GroupItemField,
  groupLabel: string,
  item: Record<string, unknown>
) {
  return {
    field_id: syntheticId,
    type: itemField.type,
    label: `${groupLabel} → ${itemField.label}`,
    required: itemField.required,
    context: item,
    ...(itemField.options?.length
      ? { options: itemField.options.slice(0, MAX_OPTIONS) }
      : {}),
    ...(itemField.constraints && Object.keys(itemField.constraints).length
      ? { constraints: itemField.constraints }
      : {})
  }
}

export interface PromptInput {
  ctx: AnswerContext
  /** Ordinary fields the deterministic pass could not answer. */
  fields: Field[]
  /** Group gaps, keyed by synthetic id. */
  gaps: { syntheticId: string; itemField: GroupItemField; groupLabel: string; item: Record<string, unknown> }[]
}

export function buildUserPrompt({ ctx, fields, gaps }: PromptInput): string {
  const { profile } = ctx

  // The `eeo` block is deliberately never included. Sensitive fields are
  // resolved without a model — see lib/answers/deterministic.ts.
  const blocks: Record<string, unknown> = {
    candidate_profile: profile,
    resume_excerpt: ctx.resumeText.slice(0, MAX_RESUME_EXCERPT),
    job: {
      apply_url: ctx.applyUrl,
      provider: ctx.providerName ?? 'unknown',
      note: 'No job description is available — Auto Apply sees the application form, not the posting. Do not invent details about the role or company.'
    },
    fields_to_answer: [
      ...fields.map(compactField),
      ...gaps.map((gap) => compactGap(gap.syntheticId, gap.itemField, gap.groupLabel, gap.item))
    ]
  }

  if (ctx.correctionRound > 0 && ctx.commandErrors.length > 0) {
    blocks.previous_attempt = buildCorrectionBlock(ctx, fields)
  }

  return JSON.stringify(blocks, null, 2)
}

/**
 * The correction-round feedback block.
 *
 * Jobo re-sends the whole field list with `command_errors` explaining what was
 * wrong. Telling the model only "it was invalid" reliably produces the same
 * answer again, so each rejection is joined with two extra facts: the value we
 * actually sent, and — for an option error — the exact list it must choose
 * from. That turns a vague retry into a targeted one.
 */
function buildCorrectionBlock(ctx: AnswerContext, fields: Field[]) {
  const fieldMap = new Map(fields.map((f) => [f.field_id, f]))
  const previous = new Map(ctx.previousAnswers.map((a) => [a.field_id, a.value]))

  return {
    correction_round: ctx.correctionRound,
    instruction:
      'Your previous answers were rejected. Re-answer EVERY entry below. Do not repeat the value under "you_sent". When code is "invalid_option", return exactly one string from "allowed_values".',
    rejected: ctx.commandErrors.map((error) => {
      const field = error.field_id ? fieldMap.get(error.field_id) : undefined
      const sent = error.field_id ? previous.get(error.field_id) : undefined

      return {
        field_id: error.field_id,
        label: field?.label ?? null,
        item_index: error.item_index,
        field_key: error.field_key,
        code: error.code,
        message: error.message,
        you_sent:
          error.item_index !== null && Array.isArray(sent)
            ? (sent as Record<string, unknown>[])[error.item_index]?.[error.field_key ?? '']
            : sent,
        ...(field?.options?.length
          ? { allowed_values: field.options.slice(0, MAX_OPTIONS).map((o) => o.value) }
          : {})
      }
    })
  }
}
