import type { Field, GroupItemField } from '@jobo-ai/autoapply'

/** Readable recorded values, without exposing expiring resume download tokens. */
export function displayAnswer(value: unknown, field?: Field | GroupItemField): string {
  if (value === null || value === undefined) return 'No value'
  if (field?.type === 'file') {
    const file = typeof value === 'object' ? (value as Record<string, unknown>) : {}
    return typeof file.filename === 'string' ? file.filename : 'Resume file'
  }
  if (field?.type === 'repeating_group' && Array.isArray(value)) {
    return value
      .map((item, index) => {
        if (!item || typeof item !== 'object') return displayAnswer(item)
        return (
          `Entry ${index + 1}\n` +
          Object.entries(item)
            .map(([key, nested]) => {
              const subfield = field.item_fields.find((f) => f.key === key)
              return `${subfield?.label ?? key}: ${displayAnswer(nested, subfield)}`
            })
            .join('\n')
        )
      })
      .join('\n\n')
  }
  if (Array.isArray(value))
    return value.map((item) => displayAnswer(item, field)).join('\n') || 'No selections'
  if (typeof value === 'boolean') return value ? 'Yes (true)' : 'No (false)'
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    if ('filename' in object && 'url' in object) return String(object.filename || 'Resume file')
    return Object.entries(object)
      .map(([key, nested]) => `${key}: ${displayAnswer(nested)}`)
      .join('\n')
  }
  const text = String(value)
  if (field && 'options' in field) {
    const option = field.options?.find((option) => option.value === value)
    if (option && option.label !== text) return `${option.label} (${text})`
  }
  return text || '(Empty text)'
}
