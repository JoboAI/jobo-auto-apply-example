import type { Field, GroupItemField } from '@jobo-ai/autoapply'
import { config } from '@/lib/config'
import { complete } from '@/lib/openrouter'
import { answerGenerationSchema, type GeneratedAnswer } from './schema'
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt'
import type { AnswerContext } from './types'

/**
 * The single OpenRouter call that answers everything the deterministic pass
 * could not.
 *
 * One call, not one per field: latency is the binding constraint inside a
 * 120-second deadline, and the model answers better when it can see the whole
 * form at once (a "years of experience" question and a "tell us about yourself"
 * question should agree with each other).
 */

export interface LlmGap {
  syntheticId: string
  field: Field
  index: number
  key: string
  itemField: GroupItemField
  groupLabel: string
  item: Record<string, unknown>
}

export interface LlmResult {
  answers: Map<string, GeneratedAnswer>
  model: string
  elapsedMs: number
}

export async function generateAnswers(
  fields: Field[],
  gaps: LlmGap[],
  ctx: AnswerContext
): Promise<LlmResult> {
  const c = config()

  const user = buildUserPrompt({
    ctx,
    fields,
    gaps: gaps.map((gap) => ({
      syntheticId: gap.syntheticId,
      itemField: gap.itemField,
      groupLabel: gap.groupLabel,
      item: gap.item
    }))
  })

  const result = await complete({
    model: c.OPENROUTER_ANSWER_MODEL,
    system: SYSTEM_PROMPT,
    user,
    schema: answerGenerationSchema,
    schemaName: 'application_answers',
    timeoutMs: ctx.budgetMs,
    // Low but not zero: open-ended answers read as templated at 0, and there is
    // nothing here that benefits from sampling diversity.
    temperature: 0.2,
    maxTokens: 4096
  })

  return {
    answers: new Map(result.data.answers.map((answer) => [answer.field_id, answer])),
    model: result.model,
    elapsedMs: result.elapsedMs
  }
}
