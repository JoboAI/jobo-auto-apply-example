import { describe, expect, it } from 'vitest'
import { runDeterministic } from '@/lib/answers/deterministic'
import { emptyProfile, type ResumeProfile } from '@/lib/resume/profile-schema'
import type { AnswerContext } from '@/lib/answers/types'
import { field, group, itemField, options } from './helpers'

function profile(overrides: Partial<ResumeProfile> = {}): ResumeProfile {
  const base = emptyProfile('Ada Lovelace', 'ada@example.com')
  return {
    ...base,
    ...overrides,
    personal: { ...base.personal, phone: '+14155550123', headline: 'Backend Engineer', ...overrides.personal },
    location: { ...base.location, city: 'Amsterdam', country_code: 'NL', country_name: 'Netherlands', ...overrides.location }
  }
}

function context(overrides: Partial<AnswerContext> = {}): AnswerContext {
  return {
    profile: profile(),
    resumeUrl: 'https://example.com/api/resumes/abc?exp=1&token=2',
    resumeFilename: 'ada.pdf',
    resumeContentType: 'application/pdf',
    resumeText: 'Ada Lovelace, backend engineer.',
    applyUrl: 'https://boards.example.com/jobs/1',
    commandErrors: [],
    correctionRound: 0,
    previousAnswers: [],
    budgetMs: 45_000,
    ...overrides
  }
}

describe('identity and contact mapping', () => {
  it('maps by provider field id', () => {
    const fields = [
      field({ field_id: 'candidate_email', type: 'text', label: 'Contact' }),
      field({ field_id: 'first_name', type: 'text', label: 'Given' }),
      field({ field_id: 'last_name', type: 'text', label: 'Family' }),
      field({ field_id: 'phone_number', type: 'text', label: 'Contact number' })
    ]
    const { resolved } = runDeterministic(fields, context())
    expect(resolved.get('candidate_email')?.value).toBe('ada@example.com')
    expect(resolved.get('first_name')?.value).toBe('Ada')
    expect(resolved.get('last_name')?.value).toBe('Lovelace')
    expect(resolved.get('phone_number')?.value).toBe('+14155550123')
  })

  it('maps by visible label when the field id is opaque', () => {
    const fields = [
      field({ field_id: 'e', type: 'text', label: 'Email Address' }),
      field({ field_id: 'c', type: 'text', label: 'City' })
    ]
    const { resolved } = runDeterministic(fields, context())
    expect(resolved.get('e')?.value).toBe('ada@example.com')
    expect(resolved.get('c')?.value).toBe('Amsterdam')
  })

  it('normalizes punctuation in provider field ids', () => {
    const fields = [field({ field_id: 'candidate.email', type: 'text', label: 'Contact' })]
    const { resolved } = runDeterministic(fields, context())
    expect(resolved.get('candidate.email')?.value).toBe('ada@example.com')
  })

  it('picks the option value for a country select', () => {
    const target = field({
      field_id: 'country',
      type: 'select',
      options: [{ value: 'nl', label: 'Netherlands' }, { value: 'us', label: 'United States' }]
    })
    const { resolved } = runDeterministic([target], context())
    expect(resolved.get('country')?.value).toBe('nl')
  })

  it('maps links by type', () => {
    const withLinks = profile({
      links: [
        { label: 'LinkedIn', type: 'linkedin', url: 'https://linkedin.com/in/ada' },
        { label: 'GitHub', type: 'github', url: 'https://github.com/ada' }
      ]
    })
    const fields = [
      field({ field_id: 'li', type: 'text', label: 'LinkedIn Profile' }),
      field({ field_id: 'gh', type: 'text', label: 'GitHub' })
    ]
    const { resolved } = runDeterministic(fields, context({ profile: withLinks }))
    expect(resolved.get('li')?.value).toBe('https://linkedin.com/in/ada')
    expect(resolved.get('gh')?.value).toBe('https://github.com/ada')
  })
})

describe('file fields', () => {
  it('answers with the signed resume URL', () => {
    const target = field({ field_id: 'cv', type: 'file', label: 'Resume' })
    const { resolved } = runDeterministic([target], context())
    expect(resolved.get('cv')?.value).toEqual({
      url: 'https://example.com/api/resumes/abc?exp=1&token=2',
      filename: 'ada.pdf',
      content_type: 'application/pdf'
    })
  })

  it('respects accepted_file_types wildcards', () => {
    const target = field({
      field_id: 'cv',
      type: 'file',
      constraints: { accepted_file_types: ['application/*'] }
    })
    expect(runDeterministic([target], context()).resolved.has('cv')).toBe(true)
  })

  it('declines rather than sending a file the field will reject', () => {
    // Answering anyway would earn invalid_file_type and burn a correction round.
    const target = field({
      field_id: 'cv',
      type: 'file',
      constraints: { accepted_file_types: ['image/png'] }
    })
    expect(runDeterministic([target], context()).resolved.has('cv')).toBe(false)
  })
})

describe('sensitive fields', () => {
  const gender = field({
    field_id: 'g',
    type: 'select',
    label: 'Gender',
    sensitive: true,
    options: [
      { value: 'male', label: 'Male' },
      { value: 'female', label: 'Female' },
      { value: 'decline', label: 'I prefer not to say' }
    ]
  })

  it('uses the advertised decline option', () => {
    expect(runDeterministic([gender], context()).resolved.get('g')?.value).toBe('decline')
  })

  it('uses the advertised decline option with the multi-select wire shape', () => {
    const demographics = field({
      field_id: 'demographics',
      type: 'multi_select',
      label: 'Voluntary demographics',
      sensitive: true,
      options: [
        { value: 'group-a', label: 'Group A' },
        { value: 'decline', label: 'Prefer not to answer' }
      ]
    })

    expect(runDeterministic([demographics], context()).resolved.get('demographics')?.value)
      .toEqual(['decline'])
  })

  it('otherwise selects the form’s own decline option', () => {
    const { resolved } = runDeterministic([gender], context())
    expect(resolved.get('g')?.value).toBe('decline')
  })

  it('leaves the field unanswered when there is no decline option', () => {
    const noDecline = field({
      field_id: 'g',
      type: 'select',
      label: 'Gender',
      sensitive: true,
      options: options('male', 'female')
    })
    const { resolved, declined } = runDeterministic([noDecline], context())
    expect(resolved.has('g')).toBe(false)
    expect(declined.has('g')).toBe(true)
  })

  it('never routes a sensitive field to the model', () => {
    const noDecline = field({
      field_id: 'g',
      type: 'select',
      label: 'Gender',
      sensitive: true,
      options: options('male', 'female')
    })
    // `declined` is terminal — index.ts excludes these from the LLM batch.
    expect(runDeterministic([noDecline], context()).declined.get('g')).toMatch(/sensitive/)
  })
})

describe('repeating groups', () => {
  const withHistory = profile({
    work_experience: [
      { company: 'Acme', title: 'Engineer', employment_type: null, location: null, start_date: '2020-01', end_date: null, is_current: true, description: 'Built things.' },
      { company: 'Globex', title: 'Junior', employment_type: null, location: null, start_date: '2018-01', end_date: '2019-12', is_current: false, description: 'Learned things.' }
    ]
  })

  const workGroup = group('w', 'work_experience', [
    itemField('company', { required: true }),
    itemField('title', { required: true }),
    itemField('start_date', { type: 'partial_date' }),
    itemField('end_date', { type: 'partial_date' }),
    itemField('is_current', { type: 'checkbox' })
  ])

  it('builds items most-recent-first', () => {
    const { resolved } = runDeterministic([workGroup], context({ profile: withHistory }))
    const items = resolved.get('w')?.value as Record<string, unknown>[]
    expect(items).toHaveLength(2)
    expect(items[0].company).toBe('Acme')
    expect(items[1].company).toBe('Globex')
  })

  it('nulls end_date on a current role', () => {
    const { resolved } = runDeterministic([workGroup], context({ profile: withHistory }))
    const items = resolved.get('w')?.value as Record<string, unknown>[]
    expect(items[0].is_current).toBe(true)
    expect(items[0].end_date).toBeNull()
    expect(items[1].end_date).toBe('2019-12')
  })

  it('emits only the keys the field advertises', () => {
    const narrow = group('w', 'work_experience', [itemField('company'), itemField('title')])
    const { resolved } = runDeterministic([narrow], context({ profile: withHistory }))
    const items = resolved.get('w')?.value as Record<string, unknown>[]
    expect(Object.keys(items[0]).sort()).toEqual(['company', 'title'])
  })

  it('respects the provider item limit', () => {
    const many = profile({
      work_experience: Array.from({ length: 15 }, (_, i) => ({
        company: `Company ${i}`,
        title: 'Engineer',
        employment_type: null,
        location: null,
        start_date: `20${String(10 + i).padStart(2, '0')}-01`,
        end_date: null,
        is_current: false,
        description: ''
      }))
    })
    const limited = group('w', 'work_experience', [itemField('company'), itemField('title')], { max_items: 12 })
    const { resolved } = runDeterministic([limited], context({ profile: many }))
    expect((resolved.get('w')?.value as unknown[]).length).toBe(12)
  })

  it('caps groups at the platform limit of 100', () => {
    const many = profile({
      work_experience: Array.from({ length: 120 }, (_, i) => ({
        company: `Company ${i}`,
        title: 'Engineer',
        employment_type: null,
        location: null,
        start_date: '2020-01',
        end_date: null,
        is_current: false,
        description: ''
      }))
    })
    const generous = group('w', 'work_experience', [itemField('company'), itemField('title')], { max_items: 150 })
    const { resolved } = runDeterministic([generous], context({ profile: many }))
    expect((resolved.get('w')?.value as unknown[]).length).toBe(100)
  })

  it('maps certification groups from the resume profile', () => {
    const certified = profile({
      certifications: [{ name: 'CKA', issuer: 'CNCF', issued: '2022-05' }]
    })
    const certificationGroup = group('c', 'certification', [
      itemField('name', { required: true }),
      itemField('issuer'),
      itemField('issued', { type: 'partial_date' })
    ])
    const { resolved } = runDeterministic([certificationGroup], context({ profile: certified }))
    expect(resolved.get('c')?.value).toEqual([{ name: 'CKA', issuer: 'CNCF', issued: '2022-05' }])
  })

  it('drops logical duplicates that Jobo would reject', () => {
    const dupes = profile({
      education: [
        { school: 'MIT', degree: 'BSc', field_of_study: 'CS', start_date: '2015-09', end_date: '2019-06', is_current: false, grade: 'A' },
        { school: 'MIT', degree: 'BSc', field_of_study: 'CS', start_date: '2015-09', end_date: '2019-06', is_current: false, grade: 'B' }
      ]
    })
    const educationGroup = group('e', 'education', [
      itemField('school'),
      itemField('degree'),
      itemField('field_of_study'),
      itemField('start_date', { type: 'partial_date' })
    ])
    const { resolved } = runDeterministic([educationGroup], context({ profile: dupes }))
    expect((resolved.get('e')?.value as unknown[]).length).toBe(1)
  })

  it('reports required item fields it could not fill as gaps for the model', () => {
    const withExtra = group('w', 'work_experience', [
      itemField('company', { required: true }),
      itemField('title', { required: true }),
      itemField('hours_per_week', { type: 'number', required: true })
    ])
    const { groupGaps } = runDeterministic([withExtra], context({ profile: withHistory }))
    expect([...groupGaps.keys()]).toContain('w#0.hours_per_week')
    expect([...groupGaps.keys()]).toContain('w#1.hours_per_week')
  })

  it('produces groups in the exact wire shape the server accepts', () => {
    // There is no local validator any more (the server validates for free on
    // submit), so pin the server's rules structurally: only advertised keys,
    // every required key present, end_date null exactly when is_current.
    const { resolved } = runDeterministic([workGroup], context({ profile: withHistory }))
    const items = resolved.get('w')?.value as Record<string, unknown>[]
    const advertised = new Set(workGroup.item_fields.map((f) => f.key))

    for (const item of items) {
      for (const key of Object.keys(item)) expect(advertised.has(key), key).toBe(true)
      expect(typeof item.company).toBe('string')
      expect(typeof item.title).toBe('string')
      if (item.is_current === true) expect(item.end_date).toBeNull()
      else if (item.end_date != null) expect(String(item.end_date)).toMatch(/^\d{4}(-\d{2}){0,2}$/)
    }
  })
})

describe('high-stakes fields', () => {
  it('defers to the model when sponsorship is unknown', () => {
    const target = field({ field_id: 's', type: 'radio', label: 'Do you require sponsorship?', options: options('Yes', 'No') })
    expect(runDeterministic([target], context()).resolved.has('s')).toBe(false)
  })

  it('answers sponsorship when the profile states it', () => {
    const stated = profile({
      work_authorization: { authorized_country_codes: ['NL'], requires_sponsorship: false, notice_period_days: 30 }
    })
    const target = field({ field_id: 's', type: 'radio', label: 'Do you require sponsorship?', options: options('Yes', 'No') })
    expect(runDeterministic([target], context({ profile: stated })).resolved.get('s')?.value).toBe('No')
  })
})

describe('unanswerable types', () => {
  it('never answers an unknown field type', () => {
    const target = field({ field_id: 'personal.email', type: 'unknown', label: 'Email' })
    expect(runDeterministic([target], context()).resolved.has('personal.email')).toBe(false)
  })
})
