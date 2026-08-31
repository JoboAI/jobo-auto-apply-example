import type { Field, FieldOption, FieldType, GroupItemField, GroupType, RepeatingGroupField } from '@jobo-ai/autoapply'

/** Shared test-builder shape for the SDK's discriminated field union. */
type FieldShape = {
  field_id: string
  type: FieldType
  label: string
  required: boolean
  requires_answer: boolean
  sensitive?: true
  format?: string
  options?: FieldOption[]
  constraints?: Record<string, unknown>
  group_type?: GroupType
  min_items?: number
  max_items?: number
  item_fields?: GroupItemField[]
}

type GroupItemFieldShape = {
  type: Exclude<FieldType, 'repeating_group'>
  label: string
  required: boolean
  options?: FieldOption[]
  constraints?: Record<string, unknown>
}

/** Build a Field with sane defaults so tests only state what they care about. */
export function field(
  overrides: Partial<FieldShape> & { field_id: string; type: FieldType }
): Field {
  return {
    label: overrides.field_id,
    required: false,
    requires_answer: false,
    ...overrides
  } as Field
}

export function itemField(
  key: string,
  overrides: Partial<GroupItemFieldShape> = {}
): GroupItemField {
  return {
    key,
    type: 'text',
    label: key,
    required: false,
    ...overrides
  } as GroupItemField
}

export function group(
  fieldId: string,
  groupType: GroupType,
  itemFields: GroupItemField[],
  overrides: Partial<FieldShape> = {}
): RepeatingGroupField {
  return field({
    field_id: fieldId,
    type: 'repeating_group',
    group_type: groupType,
    item_fields: itemFields,
    ...overrides
  }) as RepeatingGroupField
}

export function options(...values: string[]) {
  return values.map((value) => ({ value, label: value }))
}

/** Collect the error codes from a validation run, for concise assertions. */
export function codes(errors: { code: string }[]): string[] {
  return errors.map((error) => error.code).sort()
}
