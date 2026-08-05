import { describe, expect, it } from 'vitest'
import { isRealDate, isRealPartialDate, logicalFingerprint, mimeMatches, validateCommand } from '@/lib/answers/validate'
import { codes, field, group, itemField, options } from './helpers'
import type { AnswerCommand } from '@jobo-ai/autoapply'

/**
 * One case per error code the Jobo validator can emit. These are the rounds
 * this app gets to keep — the correction limit is 3, and a locally-detectable
 * mistake that reaches Jobo has cost a third of the budget.
 */

const proceed = (answers: { field_id: string; value: unknown }[]): AnswerCommand => ({
  action: 'proceed',
  answers
})

describe('command shape', () => {
  it('accepts a bare cancel', () => {
    expect(validateCommand({ action: 'cancel' }, [])).toEqual([])
  })

  it('answers_not_allowed: cancel carrying an answers key', () => {
    // Even an EMPTY array counts as specified. This is the reason AnswerCommand
    // is a discriminated union rather than an object with an optional array.
    const command = { action: 'cancel', answers: [] } as unknown as AnswerCommand
    expect(codes(validateCommand(command, []))).toEqual(['answers_not_allowed'])
  })

  it('invalid_action: anything other than proceed or cancel', () => {
    const command = { action: 'retry' } as unknown as AnswerCommand
    expect(codes(validateCommand(command, []))).toEqual(['invalid_action'])
  })

  it('duplicate_answer: the same field_id twice', () => {
    const target = field({ field_id: 'a', type: 'text' })
    const errors = validateCommand(proceed([
      { field_id: 'a', value: 'x' },
      { field_id: 'a', value: 'y' }
    ]), [target])
    expect(codes(errors)).toContain('duplicate_answer')
  })

  it('unknown_field: an answer for a field not in this event', () => {
    expect(codes(validateCommand(proceed([{ field_id: 'ghost', value: 'x' }]), []))).toEqual([
      'unknown_field'
    ])
  })

  it('required: a requires_answer field with no answer', () => {
    const target = field({ field_id: 'a', type: 'text', requires_answer: true })
    expect(codes(validateCommand(proceed([]), [target]))).toEqual(['required'])
  })
})

describe('scalar types', () => {
  it('invalid_type: non-string for text', () => {
    const target = field({ field_id: 'a', type: 'text' })
    expect(codes(validateCommand(proceed([{ field_id: 'a', value: 42 }]), [target]))).toEqual(['invalid_type'])
  })

  it('required: an empty string on a required text field', () => {
    const target = field({ field_id: 'a', type: 'text', requires_answer: true })
    expect(codes(validateCommand(proceed([{ field_id: 'a', value: '   ' }]), [target]))).toEqual(['required'])
  })

  it('invalid_type: non-number for number', () => {
    const target = field({ field_id: 'a', type: 'number' })
    expect(codes(validateCommand(proceed([{ field_id: 'a', value: '42' }]), [target]))).toEqual(['invalid_type'])
  })

  it('invalid_type: non-boolean for checkbox', () => {
    const target = field({ field_id: 'a', type: 'checkbox' })
    expect(codes(validateCommand(proceed([{ field_id: 'a', value: 'yes' }]), [target]))).toEqual(['invalid_type'])
  })

  it('minimum / maximum: number outside the advertised range', () => {
    const target = field({ field_id: 'a', type: 'number', constraints: { min: 5, max: 10 } })
    expect(codes(validateCommand(proceed([{ field_id: 'a', value: 1 }]), [target]))).toEqual(['minimum'])
    expect(codes(validateCommand(proceed([{ field_id: 'a', value: 99 }]), [target]))).toEqual(['maximum'])
    expect(validateCommand(proceed([{ field_id: 'a', value: 7 }]), [target])).toEqual([])
  })

  it('min_length / max_length / pattern', () => {
    const target = field({
      field_id: 'a',
      type: 'text',
      constraints: { min_length: 3, max_length: 6, pattern: '^[a-z]+$' }
    })
    expect(codes(validateCommand(proceed([{ field_id: 'a', value: 'ab' }]), [target]))).toEqual(['min_length'])
    expect(codes(validateCommand(proceed([{ field_id: 'a', value: 'abcdefgh' }]), [target]))).toEqual(['max_length'])
    expect(codes(validateCommand(proceed([{ field_id: 'a', value: 'AB12' }]), [target]))).toEqual(['pattern'])
    expect(validateCommand(proceed([{ field_id: 'a', value: 'abcd' }]), [target])).toEqual([])
  })

  it('invalid_constraint: a pattern this regex dialect cannot compile', () => {
    const target = field({ field_id: 'a', type: 'text', constraints: { pattern: '([unclosed' } })
    expect(codes(validateCommand(proceed([{ field_id: 'a', value: 'x' }]), [target]))).toEqual([
      'invalid_constraint'
    ])
  })
})

describe('options', () => {
  const target = field({ field_id: 'a', type: 'select', options: options('US', 'CA') })

  it('accepts an advertised value', () => {
    expect(validateCommand(proceed([{ field_id: 'a', value: 'US' }]), [target])).toEqual([])
  })

  it('invalid_option: a label instead of a value', () => {
    const labelled = field({
      field_id: 'a',
      type: 'select',
      options: [{ value: 'US', label: 'United States' }]
    })
    expect(codes(validateCommand(proceed([{ field_id: 'a', value: 'United States' }]), [labelled]))).toEqual([
      'invalid_option'
    ])
  })

  it('invalid_type: a non-string option value', () => {
    expect(codes(validateCommand(proceed([{ field_id: 'a', value: 1 }]), [target]))).toEqual(['invalid_type'])
  })

  it('multi_select: array required, and every entry must be advertised', () => {
    const multi = field({ field_id: 'm', type: 'multi_select', options: options('a', 'b') })
    expect(codes(validateCommand(proceed([{ field_id: 'm', value: 'a' }]), [multi]))).toEqual(['invalid_type'])
    expect(codes(validateCommand(proceed([{ field_id: 'm', value: ['a', 'z'] }]), [multi]))).toEqual([
      'invalid_option'
    ])
    expect(validateCommand(proceed([{ field_id: 'm', value: ['a', 'b'] }]), [multi])).toEqual([])
  })

  it('min_items / max_items on multi_select', () => {
    const multi = field({
      field_id: 'm',
      type: 'multi_select',
      options: options('a', 'b', 'c'),
      constraints: { min_items: 2, max_items: 2 }
    })
    expect(codes(validateCommand(proceed([{ field_id: 'm', value: ['a'] }]), [multi]))).toEqual(['min_items'])
    expect(codes(validateCommand(proceed([{ field_id: 'm', value: ['a', 'b', 'c'] }]), [multi]))).toEqual([
      'max_items'
    ])
  })
})

describe('dates', () => {
  it('invalid_date: a full date must be a real calendar day', () => {
    const target = field({ field_id: 'd', type: 'date' })
    expect(validateCommand(proceed([{ field_id: 'd', value: '2024-02-29' }]), [target])).toEqual([])
    expect(codes(validateCommand(proceed([{ field_id: 'd', value: '2023-02-29' }]), [target]))).toEqual([
      'invalid_date'
    ])
    expect(codes(validateCommand(proceed([{ field_id: 'd', value: '2024-1-5' }]), [target]))).toEqual([
      'invalid_date'
    ])
  })

  it('partial_date accepts YYYY, YYYY-MM and YYYY-MM-DD', () => {
    const target = field({ field_id: 'p', type: 'partial_date' })
    for (const value of ['2024', '2024-06', '2024-06-15']) {
      expect(validateCommand(proceed([{ field_id: 'p', value }]), [target]), value).toEqual([])
    }
    expect(codes(validateCommand(proceed([{ field_id: 'p', value: '2024-13' }]), [target]))).toEqual([
      'invalid_date'
    ])
  })

  it('date_precision: a value coarser than minimum_precision', () => {
    const monthly = field({ field_id: 'p', type: 'partial_date', constraints: { minimum_precision: 'month' } })
    expect(codes(validateCommand(proceed([{ field_id: 'p', value: '2024' }]), [monthly]))).toEqual([
      'date_precision'
    ])
    expect(validateCommand(proceed([{ field_id: 'p', value: '2024-06' }]), [monthly])).toEqual([])

    const daily = field({ field_id: 'p', type: 'partial_date', constraints: { minimum_precision: 'day' } })
    expect(codes(validateCommand(proceed([{ field_id: 'p', value: '2024-06' }]), [daily]))).toEqual([
      'date_precision'
    ])
  })

  it('isRealDate / isRealPartialDate agree with the server regexes', () => {
    expect(isRealDate('2024-06-15')).toBe(true)
    expect(isRealDate('2024-06')).toBe(false)
    expect(isRealPartialDate('2024-06')).toBe(true)
    expect(isRealPartialDate('2024-00')).toBe(false)
    expect(isRealPartialDate('2024-04-31')).toBe(false)
  })
})

describe('typeahead', () => {
  const target = field({ field_id: 't', type: 'typeahead' })

  it('accepts {query, selection:{value,label}}', () => {
    const value = { query: 'MIT', selection: { value: 'mit', label: 'MIT' } }
    expect(validateCommand(proceed([{ field_id: 't', value }]), [target])).toEqual([])
  })

  it('invalid_typeahead: a bare string, or a missing selection', () => {
    expect(codes(validateCommand(proceed([{ field_id: 't', value: 'MIT' }]), [target]))).toEqual([
      'invalid_typeahead'
    ])
    expect(codes(validateCommand(proceed([{ field_id: 't', value: { query: 'MIT' } }]), [target]))).toEqual([
      'invalid_typeahead'
    ])
  })

  it('required: blank query or selection', () => {
    const value = { query: '  ', selection: { value: 'mit', label: 'MIT' } }
    expect(codes(validateCommand(proceed([{ field_id: 't', value }]), [target]))).toEqual(['required'])
  })

  it('invalid_option: a selection that is not advertised', () => {
    const restricted = field({ field_id: 't', type: 'typeahead', options: options('mit') })
    const value = { query: 'Ox', selection: { value: 'oxford', label: 'Oxford' } }
    expect(codes(validateCommand(proceed([{ field_id: 't', value }]), [restricted]))).toEqual(['invalid_option'])
  })
})

describe('file', () => {
  const target = field({ field_id: 'f', type: 'file' })
  const good = { url: 'https://example.com/r.pdf', filename: 'r.pdf', content_type: 'application/pdf' }

  it('accepts an https url with a filename', () => {
    expect(validateCommand(proceed([{ field_id: 'f', value: good }]), [target])).toEqual([])
  })

  it('invalid_file: http, a relative url, or no filename', () => {
    for (const value of [
      { ...good, url: 'http://example.com/r.pdf' },
      { ...good, url: '/r.pdf' },
      { ...good, filename: '' }
    ]) {
      expect(codes(validateCommand(proceed([{ field_id: 'f', value }]), [target]))).toEqual(['invalid_file'])
    }
  })

  it('invalid_file: a non-string content_type', () => {
    const value = { ...good, content_type: 42 }
    expect(codes(validateCommand(proceed([{ field_id: 'f', value }]), [target]))).toEqual(['invalid_file'])
  })

  it('invalid_file_type: content_type outside accepted_file_types', () => {
    const restricted = field({
      field_id: 'f',
      type: 'file',
      constraints: { accepted_file_types: ['application/pdf'] }
    })
    const value = { ...good, content_type: 'text/html' }
    expect(codes(validateCommand(proceed([{ field_id: 'f', value }]), [restricted]))).toEqual([
      'invalid_file_type'
    ])
  })

  it('honours a type/* wildcard', () => {
    expect(mimeMatches('application/pdf', 'application/*')).toBe(true)
    expect(mimeMatches('APPLICATION/PDF', 'application/pdf')).toBe(true)
    expect(mimeMatches('text/html', 'application/*')).toBe(false)
  })
})

describe('repeating groups', () => {
  const education = group('g', 'education', [
    itemField('school', { required: true }),
    itemField('degree'),
    itemField('start_date', { type: 'partial_date' }),
    itemField('end_date', { type: 'partial_date' }),
    itemField('is_current', { type: 'checkbox' })
  ])

  it('accepts a well-formed group', () => {
    const value = [{ school: 'MIT', degree: 'BSc', start_date: '2015-09', end_date: '2019-06', is_current: false }]
    expect(validateCommand(proceed([{ field_id: 'g', value }]), [education])).toEqual([])
  })

  it('invalid_type: not an array', () => {
    expect(codes(validateCommand(proceed([{ field_id: 'g', value: {} }]), [education]))).toEqual(['invalid_type'])
  })

  it('invalid_item: an entry that is not an object', () => {
    expect(codes(validateCommand(proceed([{ field_id: 'g', value: ['MIT'] }]), [education]))).toEqual([
      'invalid_item'
    ])
  })

  it('unsupported_group: an unrecognised group_type', () => {
    const weird = group('g', 'nonsense' as never, [itemField('school')])
    expect(codes(validateCommand(proceed([{ field_id: 'g', value: [{ school: 'MIT' }] }]), [weird]))).toContain(
      'unsupported_group'
    )
  })

  it('unknown_item_field: a key the field does not advertise', () => {
    const value = [{ school: 'MIT', mascot: 'beaver' }]
    expect(codes(validateCommand(proceed([{ field_id: 'g', value }]), [education]))).toEqual([
      'unknown_item_field'
    ])
  })

  it('required: a missing or null required item field', () => {
    expect(codes(validateCommand(proceed([{ field_id: 'g', value: [{ degree: 'BSc' }] }]), [education]))).toEqual([
      'required'
    ])
    expect(
      codes(validateCommand(proceed([{ field_id: 'g', value: [{ school: null }] }]), [education]))
    ).toEqual(['required'])
  })

  it('current_end_date: end_date set while is_current is true', () => {
    const value = [{ school: 'MIT', is_current: true, end_date: '2024-01' }]
    expect(codes(validateCommand(proceed([{ field_id: 'g', value }]), [education]))).toEqual([
      'current_end_date'
    ])
  })

  it('allows a null end_date on a current entry, even when required', () => {
    const required = group('g', 'education', [
      itemField('school', { required: true }),
      itemField('end_date', { type: 'partial_date', required: true }),
      itemField('is_current', { type: 'checkbox' })
    ])
    const value = [{ school: 'MIT', is_current: true, end_date: null }]
    expect(validateCommand(proceed([{ field_id: 'g', value }]), [required])).toEqual([])
  })

  it('item_count: more than the platform cap of 10', () => {
    const value = Array.from({ length: 11 }, (_, i) => ({ school: `School ${i}` }))
    expect(codes(validateCommand(proceed([{ field_id: 'g', value }]), [education]))).toContain('item_count')
  })

  it('item_count: fewer than min_items', () => {
    const atLeastTwo = group('g', 'education', [itemField('school')], { min_items: 2 })
    expect(codes(validateCommand(proceed([{ field_id: 'g', value: [{ school: 'MIT' }] }]), [atLeastTwo]))).toEqual(
      ['item_count']
    )
  })

  it('duplicate_item: matched on a logical fingerprint, not deep equality', () => {
    // Same school + degree + start_date, different grade — still a duplicate.
    const value = [
      { school: 'MIT', degree: 'BSc', start_date: '2015-09' },
      { school: 'MIT', degree: 'BSc', start_date: '2015-09' }
    ]
    expect(codes(validateCommand(proceed([{ field_id: 'g', value }]), [education]))).toContain('duplicate_item')
  })

  it('validates item values against the item field type', () => {
    const value = [{ school: 'MIT', start_date: 'last September' }]
    expect(codes(validateCommand(proceed([{ field_id: 'g', value }]), [education]))).toEqual(['invalid_date'])
  })
})

describe('logicalFingerprint', () => {
  it('is case- and whitespace-insensitive', () => {
    const a = logicalFingerprint('work_experience', { company: ' Acme ', title: 'Engineer', start_date: '2020-01' })
    const b = logicalFingerprint('work_experience', { company: 'acme', title: 'engineer', start_date: '2020-01' })
    expect(a).toBe(b)
  })

  it('compares a typeahead by its selected value', () => {
    const a = logicalFingerprint('education', { school: { query: 'MIT', selection: { value: 'mit', label: 'MIT' } } })
    const b = logicalFingerprint('education', { school: 'mit' })
    expect(a).toBe(b)
  })

  it('falls back to all keys for an unrecognised group type', () => {
    expect(logicalFingerprint('other', { a: '1', b: '2' })).toBe('a:1|b:2')
  })
})

describe('unsupported field types', () => {
  it('unsupported_field: an unknown type that Jobo still requires', () => {
    const target = field({ field_id: 'u', type: 'unknown', requires_answer: true })
    expect(codes(validateCommand(proceed([{ field_id: 'u', value: 'x' }]), [target]))).toEqual([
      'unsupported_field'
    ])
  })

  it('ignores an unknown type that is optional', () => {
    const target = field({ field_id: 'u', type: 'unknown' })
    expect(validateCommand(proceed([{ field_id: 'u', value: 'x' }]), [target])).toEqual([])
  })
})
