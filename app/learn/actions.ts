'use server'

import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { applications } from '@/db/schema'
import { jobo } from '@/lib/jobo/client'
import { explain } from '@/lib/jobo/problem'
import {
  JoboValidationError,
  type Answer,
  type CommandError,
  type Field
} from '@jobo-ai/autoapply'

/**
 * The tutorial's cell 2: send a DELIBERATELY bad answer to the live step and
 * show what comes back.
 *
 * This is safe to run against a real application because validation is
 * synchronous and free: submitAnswers checks every value before anything
 * touches the employer's form, and a bad snapshot is an immediate 400 with
 * per-field errors — nothing consumed, no correction round burned, the step
 * still open. Under the old webhook flow the same mistake cost one of only
 * three correction rounds.
 */

export type ProbeResult =
  | {
      ok: true
      sent: Answer
      fieldLabel: string
      fieldType: string
      errors: CommandError[]
      elapsedMs: number
    }
  | { ok: false; reason: string }

/** A value of the wrong JSON type for the field, so the 400 is guaranteed. */
function deliberatelyWrong(field: Field): unknown {
  switch (field.type) {
    case 'number':
      return 'a competitive amount' // string where a JSON number belongs
    case 'checkbox':
      return 'yes' // string where a boolean belongs
    default:
      return 42 // number where a string / object / array belongs
  }
}

export async function probeValidationAction(id: string): Promise<ProbeResult> {
  const local = db.select().from(applications).where(eq(applications.id, id)).get()
  if (!local?.joboApplicationId) {
    return { ok: false, reason: 'This application never reached Jobo.' }
  }

  try {
    const application = await jobo().applications.get(local.joboApplicationId)
    const step = application.status === 'awaiting_answers' ? application.current_step : null
    if (!step) {
      return {
        ok: false,
        reason: `No step is awaiting answers right now (status: ${application.status}).`
      }
    }

    const field = step.fields.find((f) => f.requires_answer) ?? step.fields[0]
    if (!field) return { ok: false, reason: 'The current step has no fields.' }

    const sent: Answer = { field_id: field.field_id, value: deliberatelyWrong(field) }
    const startedAt = Date.now()

    try {
      await jobo().applications.submitAnswers(local.joboApplicationId, [sent], {
        correctionRound: step.correction_round
      })
    } catch (error) {
      if (error instanceof JoboValidationError) {
        // The happy path OF THIS CELL: per-field errors, nothing consumed.
        return {
          ok: true,
          sent,
          fieldLabel: field.label,
          fieldType: field.type,
          errors: error.errors,
          elapsedMs: Date.now() - startedAt
        }
      }
      throw error
    }

    // Unreachable with a type-mismatched value; if the server ever accepts it,
    // say so honestly rather than inventing a 400.
    return { ok: false, reason: 'The server accepted the probe — nothing to show.' }
  } catch (error) {
    return { ok: false, reason: explain(error) }
  }
}
