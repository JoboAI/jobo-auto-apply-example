import type { Field, FieldType, GroupItemField, GroupType } from '@jobo-ai/autoapply'

/**
 * The SDK's `Field` is a discriminated union — `current_value` is a `string` on
 * a text field, a `boolean` on a checkbox, and so on — which is exactly what
 * you want in application code and exactly what gets in the way in a factory
 * whose `type` is a parameter. This is the union's shared shape, with the
 * per-arm properties widened so a test can say `field({ type, current_value })`
 * without picking the arm by hand.
 */
type FieldShape = Omit<Field, 'type' | 'current_value' | 'group_type'> & {
  type: FieldType
  current_value?: unknown
  group_type?: GroupType | null
}

/** Build a Field with sane defaults so tests only state what they care about. */
export function field(
  overrides: Partial<FieldShape> & { field_id: string; type: FieldType }
): Field {
  return {
    group_type: null,
    label: overrides.field_id,
    required: false,
    requires_answer: false,
    current_value: null,
    options: [],
    constraints: {},
    category: null,
    semantic_key: null,
    sensitive: false,
    format: null,
    min_items: null,
    max_items: null,
    item_fields: [],
    ...overrides
  } as Field
}

export function itemField(
  key: string,
  overrides: Partial<GroupItemField> = {}
): GroupItemField {
  return {
    key,
    type: 'text',
    label: key,
    required: false,
    options: [],
    constraints: {},
    ...overrides
  }
}

export function group(
  fieldId: string,
  groupType: GroupType,
  itemFields: GroupItemField[],
  overrides: Partial<FieldShape> = {}
): Field {
  return field({
    field_id: fieldId,
    type: 'repeating_group',
    group_type: groupType,
    item_fields: itemFields,
    ...overrides
  })
}

export function options(...values: string[]) {
  return values.map((value) => ({ value, label: value }))
}

/** Collect the error codes from a validation run, for concise assertions. */
export function codes(errors: { code: string }[]): string[] {
  return errors.map((error) => error.code).sort()
}
