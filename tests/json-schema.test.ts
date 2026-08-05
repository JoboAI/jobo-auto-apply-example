import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { toStrictJsonSchema } from '@/lib/json-schema'
import { answerGenerationSchema } from '@/lib/answers/schema'
import { resumeProfileSchema } from '@/lib/resume/profile-schema'

/**
 * OpenRouter's strict mode silently degrades to plain JSON mode — no error, no
 * warning — unless every object sets `additionalProperties: false` AND lists
 * every property in `required`. A schema that violates this looks fine and
 * quietly stops constraining the model.
 *
 * Since the failure is invisible at runtime, it gets asserted here instead.
 */

interface SchemaNode {
  type?: string | string[]
  properties?: Record<string, SchemaNode>
  required?: string[]
  additionalProperties?: boolean
  items?: SchemaNode
  enum?: string[]
}

/** Walk every object node and assert both strict-mode invariants. */
function assertStrict(node: SchemaNode, path = '$'): number {
  let checked = 0

  const isObject = node.type === 'object' || (Array.isArray(node.type) && node.type.includes('object'))

  if (isObject) {
    checked += 1
    expect(node.additionalProperties, `${path} must set additionalProperties:false`).toBe(false)

    const properties = Object.keys(node.properties ?? {})
    expect([...(node.required ?? [])].sort(), `${path} must require every property`).toEqual(
      properties.sort()
    )

    for (const [key, child] of Object.entries(node.properties ?? {})) {
      checked += assertStrict(child, `${path}.${key}`)
    }
  }

  if (node.items) checked += assertStrict(node.items, `${path}[]`)

  return checked
}

describe('toStrictJsonSchema', () => {
  it('requires every property, including optional ones', () => {
    const schema = toStrictJsonSchema(
      z.object({ a: z.string(), b: z.string().optional() })
    ) as SchemaNode
    expect(schema.required).toEqual(['a', 'b'])
    expect(schema.additionalProperties).toBe(false)
  })

  it('expresses optionality as a nullable type union', () => {
    const schema = toStrictJsonSchema(z.object({ b: z.string().optional() })) as SchemaNode
    expect(schema.properties?.b.type).toEqual(['string', 'null'])
  })

  it('treats nullable and optional identically', () => {
    const optional = toStrictJsonSchema(z.object({ x: z.string().optional() })) as SchemaNode
    const nullable = toStrictJsonSchema(z.object({ x: z.string().nullable() })) as SchemaNode
    expect(optional.properties?.x.type).toEqual(nullable.properties?.x.type)
  })

  it('unwraps defaults to the inner type', () => {
    const schema = toStrictJsonSchema(z.object({ x: z.string().default('a') })) as SchemaNode
    expect(schema.properties?.x.type).toBe('string')
  })

  it('renders enums', () => {
    const schema = toStrictJsonSchema(z.object({ x: z.enum(['a', 'b']) })) as SchemaNode
    expect(schema.properties?.x).toMatchObject({ type: 'string', enum: ['a', 'b'] })
  })

  it('recurses into arrays of objects', () => {
    const schema = toStrictJsonSchema(
      z.object({ rows: z.array(z.object({ a: z.string(), b: z.number().nullable() })) })
    ) as SchemaNode
    expect(schema.properties?.rows.items?.required).toEqual(['a', 'b'])
    expect(schema.properties?.rows.items?.additionalProperties).toBe(false)
  })

  it('carries descriptions through, since they steer the model', () => {
    const schema = toStrictJsonSchema(z.object({ x: z.string().describe('the thing') })) as unknown as {
      properties: Record<string, { description?: string }>
    }
    expect(schema.properties.x.description).toBe('the thing')
  })

  it('refuses a type it cannot express, rather than emitting something subtly wrong', () => {
    expect(() => toStrictJsonSchema(z.object({ x: z.date() }))).toThrow(/unsupported zod type/)
  })
})

describe('the schemas we actually send', () => {
  it('the answer schema is strict at every level', () => {
    const checked = assertStrict(toStrictJsonSchema(answerGenerationSchema) as SchemaNode)
    expect(checked).toBeGreaterThan(1)
  })

  it('the resume profile schema is strict at every level', () => {
    const checked = assertStrict(toStrictJsonSchema(resumeProfileSchema) as SchemaNode)
    expect(checked).toBeGreaterThan(5)
  })

  it('the answer schema exposes one slot per value shape, plus skip', () => {
    const schema = toStrictJsonSchema(answerGenerationSchema) as SchemaNode
    const answer = schema.properties?.answers.items
    expect(Object.keys(answer?.properties ?? {}).sort()).toEqual([
      'boolean',
      'confidence',
      'field_id',
      'kind',
      'number',
      'reasoning',
      'strings',
      'text',
      'typeahead'
    ])
    expect(answer?.properties?.kind.enum).toContain('skip')
  })
})
