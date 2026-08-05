import { z } from 'zod'

/**
 * Convert a zod schema into a JSON Schema that satisfies OpenRouter's *strict*
 * structured-output mode.
 *
 * This exists because of a genuinely nasty failure mode: strict mode silently
 * degrades to plain JSON mode — no error, no warning, just unconstrained output
 * — unless EVERY object satisfies both of:
 *
 *     "additionalProperties": false
 *     "required": [ ...every single property, including the optional ones ]
 *
 * Listing only the genuinely-required keys is the intuitive thing to do and it
 * quietly turns your schema off. So this converter enforces both invariants
 * structurally, and expresses optionality the only way strict mode allows: as a
 * `["string", "null"]` type union on a key that is still required.
 *
 * Deriving the JSON Schema from the zod schema (rather than hand-writing both)
 * means the validator we parse responses with and the schema we send the model
 * cannot drift apart.
 *
 * Supports the subset used in this app: object, array, string, number, boolean,
 * enum, nullable, optional, default, and literal.
 */

export type JsonSchema = Record<string, unknown>

function unwrap(schema: z.ZodTypeAny): { inner: z.ZodTypeAny; nullable: boolean } {
  let current = schema
  let nullable = false

  // Peel wrappers until we reach a concrete type. Optional and nullable both
  // become "may be null" — strict mode has no concept of an absent key.
  for (;;) {
    const typeName = (current._def as { typeName?: string }).typeName
    if (typeName === 'ZodOptional' || typeName === 'ZodNullable') {
      nullable = true
      current = (current._def as { innerType: z.ZodTypeAny }).innerType
    } else if (typeName === 'ZodDefault') {
      current = (current._def as { innerType: z.ZodTypeAny }).innerType
    } else if (typeName === 'ZodEffects') {
      current = (current._def as { schema: z.ZodTypeAny }).schema
    } else {
      return { inner: current, nullable }
    }
  }
}

function withNull(type: string, nullable: boolean): string | string[] {
  return nullable ? [type, 'null'] : type
}

export function toStrictJsonSchema(schema: z.ZodTypeAny, description?: string): JsonSchema {
  const { inner, nullable } = unwrap(schema)
  const def = inner._def as Record<string, unknown>
  const typeName = def.typeName as string
  const node: JsonSchema = {}

  const describedBy = description ?? inner.description
  if (describedBy) node.description = describedBy

  switch (typeName) {
    case 'ZodObject': {
      const shape = (inner as z.ZodObject<z.ZodRawShape>).shape
      const properties: Record<string, JsonSchema> = {}
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = toStrictJsonSchema(value as z.ZodTypeAny)
      }
      return {
        ...node,
        type: withNull('object', nullable),
        // Both of these are load-bearing. See the comment at the top.
        additionalProperties: false,
        required: Object.keys(shape),
        properties
      }
    }

    case 'ZodArray':
      return {
        ...node,
        type: withNull('array', nullable),
        items: toStrictJsonSchema((def.type as z.ZodTypeAny) ?? z.string())
      }

    case 'ZodEnum':
      return { ...node, type: withNull('string', nullable), enum: def.values as string[] }

    case 'ZodLiteral':
      return { ...node, type: withNull('string', nullable), enum: [def.value as string] }

    case 'ZodString':
      return { ...node, type: withNull('string', nullable) }

    case 'ZodNumber':
      return { ...node, type: withNull('number', nullable) }

    case 'ZodBoolean':
      return { ...node, type: withNull('boolean', nullable) }

    default:
      throw new Error(
        `toStrictJsonSchema: unsupported zod type "${typeName}". Add a case, or simplify the schema.`
      )
  }
}

/** Wrap a schema in the `response_format` envelope OpenRouter expects. */
export function responseFormat(name: string, schema: z.ZodTypeAny) {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name,
      strict: true,
      schema: toStrictJsonSchema(schema)
    }
  }
}
