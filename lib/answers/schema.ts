import { z } from 'zod'

/**
 * The schema the answer model fills in.
 *
 * The obvious design — `{field_id, value}` where `value` is whatever the field
 * needs — is the one thing you must not do. A polymorphic `value` (string |
 * number | boolean | array | object, chosen by a sibling field's type) is
 * exactly what strict JSON Schema handles worst: `oneOf`/`anyOf` support varies
 * by model and the failure is silent, producing plausible values of the wrong
 * shape.
 *
 * Instead: **typed slots**. The model declares a `kind` and fills the matching
 * slot, leaving the others null. Every slot is required-but-nullable, which is
 * what strict mode demands (see lib/json-schema.ts). lib/answers/coerce.ts then
 * turns the slot into the exact wire value for the field's real type.
 *
 * Two fields earn their keep:
 *
 *   `kind: "skip"` gives the model an explicit way to decline. Without it, a
 *   model with nothing to say invents something, and a confident fabrication is
 *   far more expensive than a gap we can detect.
 *
 *   `reasoning` is stored per-answer and rendered in the callback log, which is
 *   what makes a wrong answer diagnosable instead of mysterious.
 */

export const answerKinds = ['text', 'number', 'boolean', 'strings', 'typeahead', 'skip'] as const

export const generatedAnswerSchema = z.object({
  field_id: z
    .string()
    .describe('Must be one of the field_id values provided in fields_to_answer.'),
  kind: z
    .enum(answerKinds)
    .describe(
      'Which slot below holds the answer. Use "skip" if you genuinely cannot answer from the profile — never invent facts.'
    ),
  text: z
    .string()
    .nullable()
    .describe('For kind=text: free text, or the exact option `value` string for a choice field.'),
  number: z.number().nullable().describe('For kind=number.'),
  boolean: z.boolean().nullable().describe('For kind=boolean.'),
  strings: z
    .array(z.string())
    .nullable()
    .describe('For kind=strings: multi-select. Each entry must be an exact option `value`.'),
  typeahead: z
    .object({
      query: z.string(),
      value: z.string(),
      label: z.string()
    })
    .nullable()
    .describe('For kind=typeahead. `value` must be an advertised option value when options exist.'),
  confidence: z.number().describe('0 to 1.'),
  reasoning: z.string().describe('One short sentence on where this answer came from.')
})

export const answerGenerationSchema = z.object({
  answers: z.array(generatedAnswerSchema)
})

export type GeneratedAnswer = z.infer<typeof generatedAnswerSchema>
export type AnswerGeneration = z.infer<typeof answerGenerationSchema>

/**
 * Pull the value out of whichever slot the model declared.
 * Returns undefined for `skip`, or when the declared slot is empty.
 */
export function slotValue(answer: GeneratedAnswer): string | number | boolean | string[] | Record<string, unknown> | undefined {
  switch (answer.kind) {
    case 'text':
      return answer.text ?? undefined
    case 'number':
      return answer.number ?? undefined
    case 'boolean':
      return answer.boolean ?? undefined
    case 'strings':
      return answer.strings ?? undefined
    case 'typeahead':
      return answer.typeahead
        ? {
            query: answer.typeahead.query,
            selection: { value: answer.typeahead.value, label: answer.typeahead.label }
          }
        : undefined
    case 'skip':
      return undefined
    default:
      return undefined
  }
}
