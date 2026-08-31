import type { Field, GroupItemField } from '@jobo-ai/autoapply'
import { groupItemOptions } from './options'

/**
 * Treat one field *inside* a repeating group as if it were a top-level field,
 * so coercion and validation can be shared between the two.
 *
 * `GroupItemField` is deliberately not a `Field`: it is keyed by `key` rather
 * than `field_id` and carries no semantics of its own. This is the one place
 * the SDK's discriminated `Field` union has to be re-entered by hand — the
 * item's `type` is only known at runtime, so the compiler cannot pick the arm
 * for us. Every other `Field` in this app is narrowed properly.
 *
 * Lives in its own module because both `coerce.ts` and `validate.ts` need it,
 * and `coerce.ts` already imports from `validate.ts`.
 */
export function asItemField(parent: Field, item: GroupItemField): Field {
  const options = groupItemOptions(item)
  return {
    field_id: `${parent.field_id}.${item.key}`,
    type: item.type,
    label: item.label,
    required: item.required,
    requires_answer: item.required,
    ...(parent.sensitive ? { sensitive: true as const } : {}),
    ...(options.length ? { options } : {}),
    ...(item.constraints && Object.keys(item.constraints).length
      ? { constraints: item.constraints }
      : {})
  } as unknown as Field
}
