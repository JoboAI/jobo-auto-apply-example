import { describe, expect, it } from 'vitest'
import { coerceValue } from '@/lib/answers/coerce'
import { field, options } from './helpers'

/**
 * Coercion turns a loosely-typed model answer into the exact wire shape a field
 * expects. The contract that matters: whatever comes out either validates, or
 * is `undefined`. It must never produce a value that Jobo will reject.
 */

describe('text and textarea', () => {
  it('trims, and stringifies scalars', () => {
    expect(coerceValue('  hi  ', field({ field_id: 'a', type: 'text' }))).toBe('hi')
    expect(coerceValue(42, field({ field_id: 'a', type: 'text' }))).toBe('42')
    expect(coerceValue(true, field({ field_id: 'a', type: 'text' }))).toBe('true')
  })

  it('joins an array rather than dropping it', () => {
    expect(coerceValue(['a', 'b'], field({ field_id: 'a', type: 'text' }))).toBe('a, b')
  })

  it('returns undefined for an empty string, so it is left unanswered', () => {
    expect(coerceValue('   ', field({ field_id: 'a', type: 'text' }))).toBeUndefined()
  })

  it('clamps to max_length at a word boundary where it can', () => {
    const target = field({ field_id: 'a', type: 'textarea', constraints: { max_length: 20 } })
    const result = coerceValue('the quick brown fox jumps over', target) as string
    expect(result.length).toBeLessThanOrEqual(20)
    expect(result).toBe('the quick brown fox')
  })
})

describe('number', () => {
  it('strips currency symbols and separators', () => {
    const target = field({ field_id: 'n', type: 'number' })
    expect(coerceValue('$120,000', target)).toBe(120000)
    expect(coerceValue('  42 ', target)).toBe(42)
    expect(coerceValue(-3.5, target)).toBe(-3.5)
  })

  it('clamps into the advertised range', () => {
    const target = field({ field_id: 'n', type: 'number', constraints: { min: 0, max: 10 } })
    expect(coerceValue(99, target)).toBe(10)
    expect(coerceValue(-5, target)).toBe(0)
  })

  it('returns undefined for something with no number in it', () => {
    expect(coerceValue('negotiable', field({ field_id: 'n', type: 'number' }))).toBeUndefined()
  })
})

describe('checkbox', () => {
  const target = field({ field_id: 'c', type: 'checkbox' })

  it('accepts the many ways a model says yes or no', () => {
    for (const value of [true, 'true', 'yes', 'Y', '1', 'checked']) {
      expect(coerceValue(value as never, target), String(value)).toBe(true)
    }
    for (const value of [false, 'false', 'no', 'N', '0', 'unchecked']) {
      expect(coerceValue(value as never, target), String(value)).toBe(false)
    }
  })

  it('returns undefined for something genuinely ambiguous', () => {
    expect(coerceValue('maybe', target)).toBeUndefined()
  })
})

describe('select and radio', () => {
  it('maps a label onto its option value', () => {
    const target = field({
      field_id: 's',
      type: 'select',
      options: [{ value: 'US', label: 'United States' }]
    })
    expect(coerceValue('United States', target)).toBe('US')
  })

  it('maps a country code onto a spelled-out option', () => {
    const target = field({
      field_id: 's',
      type: 'select',
      options: [{ value: 'united-states', label: 'United States' }]
    })
    expect(coerceValue('US', target)).toBe('united-states')
  })

  it('maps a boolean onto a yes/no option list', () => {
    const target = field({ field_id: 's', type: 'radio', options: options('Yes', 'No') })
    expect(coerceValue(true, target)).toBe('Yes')
    expect(coerceValue(false, target)).toBe('No')
  })

  it('returns undefined rather than inventing an option', () => {
    const target = field({ field_id: 's', type: 'select', options: options('a', 'b') })
    expect(coerceValue('something else entirely', target)).toBeUndefined()
  })
})

describe('multi_select', () => {
  const target = field({ field_id: 'm', type: 'multi_select', options: options('a', 'b', 'c') })

  it('splits a comma-separated string', () => {
    expect(coerceValue('a, b', target)).toEqual(['a', 'b'])
  })

  it('drops entries that match no option, keeping the rest', () => {
    expect(coerceValue(['a', 'zzz'], target)).toEqual(['a'])
  })

  it('deduplicates', () => {
    expect(coerceValue(['a', 'a'], target)).toEqual(['a'])
  })

  it('truncates to max_items', () => {
    const capped = field({
      field_id: 'm',
      type: 'multi_select',
      options: options('a', 'b', 'c'),
      constraints: { max_items: 2 }
    })
    expect(coerceValue(['a', 'b', 'c'], capped)).toEqual(['a', 'b'])
  })
})

describe('dates', () => {
  it('pads a partial value out to a full date', () => {
    const target = field({ field_id: 'd', type: 'date' })
    expect(coerceValue('2024-06', target)).toBe('2024-06-01')
    expect(coerceValue('2024', target)).toBe('2024-01-01')
  })

  it('normalises loose formats for partial_date', () => {
    const target = field({ field_id: 'p', type: 'partial_date' })
    expect(coerceValue('March 2021', target)).toBe('2021-03')
    expect(coerceValue('03/2021', target)).toBe('2021-03')
  })

  it('extends a value to satisfy minimum_precision', () => {
    const monthly = field({ field_id: 'p', type: 'partial_date', constraints: { minimum_precision: 'month' } })
    expect(coerceValue('2024', monthly)).toBe('2024-01')

    const daily = field({ field_id: 'p', type: 'partial_date', constraints: { minimum_precision: 'day' } })
    expect(coerceValue('2024-06', daily)).toBe('2024-06-01')
    expect(coerceValue('2024', daily)).toBe('2024-01-01')
  })
})

describe('typeahead', () => {
  it('builds the full shape from a bare string when nothing is advertised', () => {
    const target = field({ field_id: 't', type: 'typeahead' })
    expect(coerceValue('MIT', target)).toEqual({
      query: 'MIT',
      selection: { value: 'MIT', label: 'MIT' }
    })
  })

  it('snaps a bare string onto an advertised option', () => {
    const target = field({
      field_id: 't',
      type: 'typeahead',
      options: [{ value: 'mit', label: 'MIT' }]
    })
    expect(coerceValue('MIT', target)).toEqual({ query: 'MIT', selection: { value: 'mit', label: 'MIT' } })
  })

  it('repairs a flat {value,label} object into {query,selection}', () => {
    const target = field({ field_id: 't', type: 'typeahead' })
    expect(coerceValue({ value: 'mit', label: 'MIT' }, target)).toEqual({
      query: 'MIT',
      selection: { value: 'mit', label: 'MIT' }
    })
  })

  it('returns undefined when no advertised option matches', () => {
    const target = field({ field_id: 't', type: 'typeahead', options: options('mit') })
    expect(coerceValue('Oxford', target)).toBeUndefined()
  })
})

describe('types coercion never produces', () => {
  it('file is built by the deterministic pass, not by coercion', () => {
    expect(coerceValue('resume.pdf', field({ field_id: 'f', type: 'file' }))).toBeUndefined()
  })

  it('unknown is unanswerable by contract', () => {
    expect(coerceValue('x', field({ field_id: 'u', type: 'unknown' }))).toBeUndefined()
  })
})

describe('the round-trip invariant', () => {
  /**
   * The property that actually matters: for every field type, a coerced value
   * is either the EXACT wire shape the server accepts, or undefined. There is
   * no local validator to double-check any more — the server validates for
   * free on submit — so these cases pin the expected wire value itself.
   */
  const cases: {
    name: string
    field: ReturnType<typeof field>
    input: unknown
    expected: unknown
  }[] = [
    { name: 'text', field: field({ field_id: 'x', type: 'text' }), input: '  hello  ', expected: 'hello' },
    {
      name: 'textarea',
      field: field({ field_id: 'x', type: 'textarea', constraints: { max_length: 10 } }),
      input: 'a'.repeat(50),
      expected: 'a'.repeat(10)
    },
    { name: 'number', field: field({ field_id: 'x', type: 'number', constraints: { max: 5 } }), input: '$99', expected: 5 },
    { name: 'checkbox', field: field({ field_id: 'x', type: 'checkbox' }), input: 'yes', expected: true },
    {
      name: 'select',
      field: field({ field_id: 'x', type: 'select', options: [{ value: 'US', label: 'United States' }] }),
      input: 'United States',
      expected: 'US'
    },
    { name: 'radio', field: field({ field_id: 'x', type: 'radio', options: options('Yes', 'No') }), input: true, expected: 'Yes' },
    {
      name: 'multi_select',
      field: field({ field_id: 'x', type: 'multi_select', options: options('a', 'b') }),
      input: 'a,b',
      expected: ['a', 'b']
    },
    { name: 'date', field: field({ field_id: 'x', type: 'date' }), input: '2024-06', expected: '2024-06-01' },
    {
      name: 'partial_date',
      field: field({ field_id: 'x', type: 'partial_date', constraints: { minimum_precision: 'month' } }),
      input: '2024',
      expected: '2024-01'
    },
    {
      name: 'typeahead',
      field: field({ field_id: 'x', type: 'typeahead' }),
      input: 'MIT',
      expected: { query: 'MIT', selection: { value: 'MIT', label: 'MIT' } }
    }
  ]

  for (const testCase of cases) {
    it(`${testCase.name}: coerces to the exact wire shape`, () => {
      const value = coerceValue(testCase.input as never, testCase.field)
      expect(value).toEqual(testCase.expected)
    })
  }
})
