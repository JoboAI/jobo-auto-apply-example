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

function unwrap(schema: z.ZodType): { inner: z.ZodType; nullable: boolean } {
  let current = schema
  let nullable = false

  // Peel wrappers until we reach a concrete type. Optional and nullable both
  // become "may be null" — strict mode has no concept of an absent key.
  for (;;) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      nullable = true
      current = current.unwrap() as z.ZodType
    } else if (current instanceof z.ZodDefault) {
      current = current.unwrap() as z.ZodType
    } else if (current instanceof z.ZodPipe) {
      // .transform() and .preprocess(): the model produces the input side.
      current = current.in as z.ZodType
    } else {
      return { inner: current, nullable }
    }
  }
}

function withNull(type: string, nullable: boolean): string | string[] {
  return nullable ? [type, 'null'] : type
}

export function toStrictJsonSchema(schema: z.ZodType, description?: string): JsonSchema {
  const { inner, nullable } = unwrap(schema)
  const node: JsonSchema = {}

  const describedBy = description ?? inner.description ?? schema.description
  if (describedBy) node.description = describedBy

  if (inner instanceof z.ZodObject) {
    const shape = inner.shape as Record<string, z.ZodType>
    const properties: Record<string, JsonSchema> = {}
    for (const [key, value] of Object.entries(shape)) properties[key] = toStrictJsonSchema(value)
    return {
      ...node,
      type: withNull('object', nullable),
      // Both of these are load-bearing. See the comment at the top.
      additionalProperties: false,
      required: Object.keys(shape),
      properties,
    }
  }
  if (inner instanceof z.ZodArray)
    return {
      ...node,
      type: withNull('array', nullable),
      items: toStrictJsonSchema(inner.element as z.ZodType),
    }
  if (inner instanceof z.ZodEnum)
    return { ...node, type: withNull('string', nullable), enum: inner.options as string[] }
  if (inner instanceof z.ZodLiteral)
    return { ...node, type: withNull('string', nullable), enum: [...inner.values] as string[] }
  if (inner instanceof z.ZodString) return { ...node, type: withNull('string', nullable) }
  if (inner instanceof z.ZodNumber) return { ...node, type: withNull('number', nullable) }
  if (inner instanceof z.ZodBoolean) return { ...node, type: withNull('boolean', nullable) }
  throw new Error(
    `toStrictJsonSchema: unsupported zod type "${inner.def.type}". Add a case, or simplify the schema.`,
  )
}

/** Wrap a schema in the `response_format` envelope OpenRouter expects. */
export function responseFormat(name: string, schema: z.ZodType) {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name,
      strict: true,
      schema: toStrictJsonSchema(schema),
    },
  }
}
