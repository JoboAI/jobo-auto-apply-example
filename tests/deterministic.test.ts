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
    personal: {
      ...base.personal,
      phone: '+14155550123',
      ...overrides.personal,
    },
    location: {
      ...base.location,
      city: 'Amsterdam',
      country_code: 'NL',
      country_name: 'Netherlands',
      ...overrides.location,
    },
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
    ...overrides,
  }
}

describe('identity and contact mapping', () => {
  it('maps by provider field id', () => {
    const fields = [
      field({ field_id: 'candidate_email', type: 'text', label: 'Contact' }),
      field({ field_id: 'first_name', type: 'text', label: 'Given' }),
      field({ field_id: 'last_name', type: 'text', label: 'Family' }),
      field({
        field_id: 'phone_number',
        type: 'text',
        label: 'Contact number',
      }),
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
      field({ field_id: 'c', type: 'text', label: 'City' }),
    ]
    const { resolved } = runDeterministic(fields, context())
    expect(resolved.get('e')?.value).toBe('ada@example.com')
    expect(resolved.get('c')?.value).toBe('Amsterdam')
  })

  it('normalizes punctuation in provider field ids', () => {
    const fields = [
      field({ field_id: 'candidate.email', type: 'text', label: 'Contact' }),
    ]
    const { resolved } = runDeterministic(fields, context())
    expect(resolved.get('candidate.email')?.value).toBe('ada@example.com')
  })

  it('picks the option value for a country select', () => {
    const target = field({
      field_id: 'country',
      type: 'select',
      options: [
        { value: 'nl', label: 'Netherlands' },
        { value: 'us', label: 'United States' },
      ],
    })
    const { resolved } = runDeterministic([target], context())
    expect(resolved.get('country')?.value).toBe('nl')
  })

  it('maps links by type', () => {
    const withLinks = profile({
      links: {
        linkedin: 'https://linkedin.com/in/ada',
        github: 'https://github.com/ada',
        portfolio: null,
        other: 'https://ada.example.com',
      },
    })
    const fields = [
      field({ field_id: 'li', type: 'text', label: 'LinkedIn Profile' }),
      field({ field_id: 'gh', type: 'text', label: 'GitHub' }),
      field({ field_id: 'ow', type: 'text', label: 'Other website' }),
      field({ field_id: 'pf', type: 'text', label: 'Portfolio' }),
    ]
    const { resolved } = runDeterministic(
      fields,
      context({ profile: withLinks }),
    )
    expect(resolved.get('li')?.value).toBe('https://linkedin.com/in/ada')
    expect(resolved.get('gh')?.value).toBe('https://github.com/ada')
    expect(resolved.get('ow')?.value).toBe('https://ada.example.com')
    // No portfolio: the other URL is the next best personal link.
    expect(resolved.get('pf')?.value).toBe('https://ada.example.com')
  })

  it('answers a preferred-name field before first_name can claim it', () => {
    const fields = [
      field({ field_id: 'preferred_first_name', type: 'text', label: 'Preferred first name' }),
      field({ field_id: 'first_name', type: 'text', label: 'First name' }),
      field({ field_id: 'full_name', type: 'text', label: 'Full name' }),
    ]
    const named = profile({ personal: { ...profile().personal, preferred_name: 'Addy' } })
    const { resolved } = runDeterministic(fields, context({ profile: named }))
    expect(resolved.get('preferred_first_name')?.value).toBe('Addy')
    expect(resolved.get('first_name')?.value).toBe('Ada')
    expect(resolved.get('full_name')?.value).toBe('Ada Lovelace')
    // No preferred name: the first name is the name they go by.
    expect(
      runDeterministic(fields, context()).resolved.get('preferred_first_name')?.value,
    ).toBe('Ada')
  })

  it('derives current title and company from the current role', () => {
    const employed = profile({
      experience: [
        { company: 'Globex', title: 'Junior', location: null, type: null, start_month: 1, start_year: 2018, end_month: 12, end_year: 2019, currently_working: false, description: '' },
        { company: 'Acme', title: 'Engineer', location: null, type: null, start_month: 1, start_year: 2020, end_month: null, end_year: null, currently_working: true, description: '' },
      ],
    })
    const fields = [
      field({ field_id: 'current_title', type: 'text', label: 'Current title' }),
      field({ field_id: 'current_company', type: 'text', label: 'Current company' }),
    ]
    const { resolved } = runDeterministic(fields, context({ profile: employed }))
    expect(resolved.get('current_title')?.value).toBe('Engineer')
    expect(resolved.get('current_company')?.value).toBe('Acme')
  })
})

describe('age', () => {
  const adult = field({
    field_id: 'q_age',
    type: 'radio',
    label: 'Are you at least 18 years of age?',
    options: options('Yes', 'No'),
  })

  it('answers over-18 questions from the date of birth', () => {
    const born = (birthday: string) =>
      context({ profile: profile({ personal: { ...profile().personal, birthday } }) })
    expect(runDeterministic([adult], born('1990-01-01')).resolved.get('q_age')?.value).toBe('Yes')
    const today = new Date()
    const minor = `${today.getUTCFullYear() - 16}-01-01`
    expect(runDeterministic([adult], born(minor)).resolved.get('q_age')?.value).toBe('No')
  })

  it('declines rather than letting the model assume an age', () => {
    const result = runDeterministic([adult], context())
    expect(result.resolved.has('q_age')).toBe(false)
    expect(result.declined.get('q_age')).toMatch(/date of birth/)
  })

  it('fills a date-of-birth field', () => {
    const dob = field({ field_id: 'dob', type: 'date', label: 'Date of birth' })
    const ctx = context({ profile: profile({ personal: { ...profile().personal, birthday: '1990-12-10' } }) })
    expect(runDeterministic([dob], ctx).resolved.get('dob')?.value).toBe('1990-12-10')
  })
})

describe('file fields', () => {
  it('answers with the signed resume URL', () => {
    const target = field({ field_id: 'cv', type: 'file', label: 'Resume' })
    const { resolved } = runDeterministic([target], context())
    expect(resolved.get('cv')?.value).toEqual({
      url: 'https://example.com/api/resumes/abc?exp=1&token=2',
      filename: 'ada.pdf',
      content_type: 'application/pdf',
    })
  })

  it('respects accepted_file_types wildcards', () => {
    const target = field({
      field_id: 'cv',
      type: 'file',
      constraints: { accepted_file_types: ['application/*'] },
    })
    expect(runDeterministic([target], context()).resolved.has('cv')).toBe(true)
  })

  it('declines rather than sending a file the field will reject', () => {
    // Answering anyway would earn invalid_file_type and burn a correction round.
    const target = field({
      field_id: 'cv',
      type: 'file',
      constraints: { accepted_file_types: ['image/png'] },
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
      { value: 'decline', label: 'I prefer not to say' },
    ],
  })

  it('uses the advertised decline option', () => {
    expect(runDeterministic([gender], context()).resolved.get('g')?.value).toBe(
      'decline',
    )
  })

  it('answers from the candidate’s own self-identification', () => {
    const identified = profile({ eeo: { ...profile().eeo, gender: 'female' } })
    const result = runDeterministic([gender], context({ profile: identified }))
    expect(result.resolved.get('g')?.value).toBe('female')
    expect(result.resolved.get('g')?.rule).toMatch(/^sensitive:gender/)
  })

  it('uses the advertised decline option with the multi-select wire shape', () => {
    const demographics = field({
      field_id: 'demographics',
      type: 'multi_select',
      label: 'Voluntary demographics',
      sensitive: true,
      options: [
        { value: 'group-a', label: 'Group A' },
        { value: 'decline', label: 'Prefer not to answer' },
      ],
    })

    expect(
      runDeterministic([demographics], context()).resolved.get('demographics')
        ?.value,
    ).toEqual(['decline'])
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
      options: options('male', 'female'),
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
      options: options('male', 'female'),
    })
    // `declined` is terminal — index.ts excludes these from the LLM batch.
    expect(runDeterministic([noDecline], context()).declined.get('g')).toMatch(
      /sensitive/,
    )
  })
})

describe('repeating groups', () => {
  const role = (
    company: string,
    start_year: number,
    end: [number, number] | null,
    extra: Partial<ResumeProfile['experience'][number]> = {},
  ): ResumeProfile['experience'][number] => ({
    company,
    title: 'Engineer',
    location: null,
    type: null,
    start_month: 1,
    start_year,
    end_month: end?.[0] ?? null,
    end_year: end?.[1] ?? null,
    currently_working: end === null,
    description: '',
    ...extra,
  })
  const withHistory = profile({
    experience: [
      role('Globex', 2018, [12, 2019], { title: 'Junior', description: 'Learned things.' }),
      role('Acme', 2020, null, { description: 'Built things.' }),
    ],
  })

  const workGroup = group('w', 'work_experience', [
    itemField('company', { required: true }),
    itemField('title', { required: true }),
    itemField('start_date', { type: 'partial_date' }),
    itemField('end_date', { type: 'partial_date' }),
    itemField('is_current', { type: 'checkbox' }),
  ])

  it('builds items most-recent-first', () => {
    const { resolved } = runDeterministic(
      [workGroup],
      context({ profile: withHistory }),
    )
    const items = resolved.get('w')?.value as Record<string, unknown>[]
    expect(items).toHaveLength(2)
    expect(items[0].company).toBe('Acme')
    expect(items[1].company).toBe('Globex')
  })

  it('nulls end_date on a current role', () => {
    const { resolved } = runDeterministic(
      [workGroup],
      context({ profile: withHistory }),
    )
    const items = resolved.get('w')?.value as Record<string, unknown>[]
    expect(items[0].is_current).toBe(true)
    expect(items[0].end_date).toBeNull()
    expect(items[1].end_date).toBe('2019-12')
  })

  it('emits only the keys the field advertises', () => {
    const narrow = group('w', 'work_experience', [
      itemField('company'),
      itemField('title'),
    ])
    const { resolved } = runDeterministic(
      [narrow],
      context({ profile: withHistory }),
    )
    const items = resolved.get('w')?.value as Record<string, unknown>[]
    expect(Object.keys(items[0]).sort()).toEqual(['company', 'title'])
  })

  it('respects the provider item limit', () => {
    const many = profile({
      experience: Array.from({ length: 15 }, (_, i) =>
        role(`Company ${i}`, 2010 + i, [6, 2010 + i]),
      ),
    })
    const limited = group(
      'w',
      'work_experience',
      [itemField('company'), itemField('title')],
      { max_items: 12 },
    )
    const { resolved } = runDeterministic([limited], context({ profile: many }))
    expect((resolved.get('w')?.value as unknown[]).length).toBe(12)
  })

  it('caps groups at the platform limit of 100', () => {
    const many = profile({
      experience: Array.from({ length: 120 }, (_, i) =>
        role(`Company ${i}`, 2020, [6, 2020]),
      ),
    })
    const generous = group(
      'w',
      'work_experience',
      [itemField('company'), itemField('title')],
      { max_items: 150 },
    )
    const { resolved } = runDeterministic(
      [generous],
      context({ profile: many }),
    )
    expect((resolved.get('w')?.value as unknown[]).length).toBe(100)
  })

  it('maps employment type labels and month/year dates', () => {
    const typed = profile({
      experience: [role('Acme', 2020, [3, 2021], { start_month: 4, type: 'contract' })],
    })
    const typedGroup = group('w', 'work_experience', [
      itemField('company'),
      itemField('employment_type', { type: 'select', options: options('Full-time', 'Contract') }),
      itemField('start_date', { type: 'partial_date' }),
      itemField('end_date', { type: 'partial_date' }),
    ])
    const { resolved } = runDeterministic([typedGroup], context({ profile: typed }))
    expect(resolved.get('w')?.value).toEqual([
      { company: 'Acme', employment_type: 'Contract', start_date: '2020-04', end_date: '2021-03' },
    ])
  })

  it('matches a degree to the form’s own option wording', () => {
    const educated = profile({
      education: [
        { school: 'MIT', degree: 'bs', major: 'CS', gpa: 3.8, start_month: 9, start_year: 2015, grad_month: 6, grad_year: 2019 },
      ],
    })
    const educationGroup = group('e', 'education', [
      itemField('school'),
      itemField('degree', {
        type: 'select',
        options: [
          { value: '1', label: "Associate's Degree" },
          { value: '2', label: "Bachelor's Degree" },
          { value: '3', label: "Master's Degree" },
        ],
      }),
      itemField('field_of_study'),
      itemField('gpa', { type: 'number' }),
      itemField('end_date', { type: 'partial_date' }),
    ])
    const { resolved } = runDeterministic([educationGroup], context({ profile: educated }))
    expect(resolved.get('e')?.value).toEqual([
      { school: 'MIT', degree: '2', field_of_study: 'CS', gpa: 3.8, end_date: '2019-06' },
    ])
    // Free text gets the full name of the degree.
    const textGroup = group('e', 'education', [itemField('degree')])
    expect(runDeterministic([textGroup], context({ profile: educated })).resolved.get('e')?.value)
      .toEqual([{ degree: 'Bachelor of Science' }])
  })

  it('treats education with a future graduation as current', () => {
    const year = new Date().getUTCFullYear() + 1
    const studying = profile({
      education: [
        { school: 'MIT', degree: 'ms', major: 'CS', gpa: null, start_month: 9, start_year: year - 2, grad_month: 6, grad_year: year },
      ],
    })
    const educationGroup = group('e', 'education', [
      itemField('school'),
      itemField('end_date', { type: 'partial_date' }),
      itemField('is_current', { type: 'checkbox' }),
    ])
    expect(runDeterministic([educationGroup], context({ profile: studying })).resolved.get('e')?.value)
      .toEqual([{ school: 'MIT', end_date: null, is_current: true }])
  })

  it('builds website and language groups from the link slots and names', () => {
    const linked = profile({
      links: { linkedin: 'https://linkedin.com/in/ada', github: null, portfolio: 'https://ada.dev', other: null },
      languages: ['English', 'Dutch'],
    })
    const websites = group('ws', 'website', [itemField('url'), itemField('type')])
    const languages = group('ls', 'language', [itemField('language')])
    const { resolved } = runDeterministic([websites, languages], context({ profile: linked }))
    expect(resolved.get('ws')?.value).toEqual([
      { url: 'https://linkedin.com/in/ada', type: 'linkedin' },
      { url: 'https://ada.dev', type: 'portfolio' },
    ])
    expect(resolved.get('ls')?.value).toEqual([{ language: 'English' }, { language: 'Dutch' }])
  })

  it('drops logical duplicates that Jobo would reject', () => {
    const mit = {
      school: 'MIT',
      degree: 'bs' as const,
      major: 'CS',
      start_month: 9,
      start_year: 2015,
      grad_month: 6,
      grad_year: 2019,
    }
    const dupes = profile({
      education: [
        { ...mit, gpa: 3.9 },
        { ...mit, gpa: 3.1 },
      ],
    })
    const educationGroup = group('e', 'education', [
      itemField('school'),
      itemField('degree'),
      itemField('field_of_study'),
      itemField('start_date', { type: 'partial_date' }),
    ])
    const { resolved } = runDeterministic(
      [educationGroup],
      context({ profile: dupes }),
    )
    expect((resolved.get('e')?.value as unknown[]).length).toBe(1)
  })

  it('reports required item fields it could not fill as gaps for the model', () => {
    const withExtra = group('w', 'work_experience', [
      itemField('company', { required: true }),
      itemField('title', { required: true }),
      itemField('hours_per_week', { type: 'number', required: true }),
    ])
    const { groupGaps } = runDeterministic(
      [withExtra],
      context({ profile: withHistory }),
    )
    expect([...groupGaps.keys()]).toContain('w#0.hours_per_week')
    expect([...groupGaps.keys()]).toContain('w#1.hours_per_week')
  })

  it('produces groups in the exact wire shape the server accepts', () => {
    // There is no local validator any more (the server validates for free on
    // submit), so pin the server's rules structurally: only advertised keys,
    // every required key present, end_date null exactly when is_current.
    const { resolved } = runDeterministic(
      [workGroup],
      context({ profile: withHistory }),
    )
    const items = resolved.get('w')?.value as Record<string, unknown>[]
    const advertised = new Set(workGroup.item_fields.map((f) => f.key))

    for (const item of items) {
      for (const key of Object.keys(item))
        expect(advertised.has(key), key).toBe(true)
      expect(typeof item.company).toBe('string')
      expect(typeof item.title).toBe('string')
      if (item.is_current === true) expect(item.end_date).toBeNull()
      else if (item.end_date != null)
        expect(String(item.end_date)).toMatch(/^\d{4}(-\d{2}){0,2}$/)
    }
  })
})

describe('high-stakes fields', () => {
  it('leaves unknown sponsorship unresolved without guessing', () => {
    const target = field({
      field_id: 's',
      type: 'radio',
      label: 'Do you require sponsorship?',
      options: options('Yes', 'No'),
    })
    expect(runDeterministic([target], context()).resolved.has('s')).toBe(false)
  })

  it('answers sponsorship when the profile states it', () => {
    const stated = profile({
      work_authorization: { ...profile().work_authorization, requires_sponsorship: false },
    })
    const target = field({
      field_id: 's',
      type: 'radio',
      label: 'Do you require sponsorship?',
      options: options('Yes', 'No'),
    })
    expect(
      runDeterministic([target], context({ profile: stated })).resolved.get('s')
        ?.value,
    ).toBe('No')
  })
})

describe('unanswerable types', () => {
  it('never answers an unknown field type', () => {
    const target = field({
      field_id: 'personal.email',
      type: 'unknown',
      label: 'Email',
    })
    expect(
      runDeterministic([target], context()).resolved.has('personal.email'),
    ).toBe(false)
  })
})

describe('work authorization', () => {
  const candidate = profile({
    work_authorization: {
      us: false,
      canada: true,
      uk: true,
      other_country_codes: ['NL'],
      requires_sponsorship: false,
    },
  })
  const ask = (label: string, jobCountryCode?: string, who = candidate) => {
    const f = field({ field_id: 'q', type: 'radio', label, options: options('Yes', 'No') })
    return runDeterministic([f], context({ profile: who, jobCountryCode }))
  }
  const generic = 'Are you legally authorized to work in the country where this job is located?'

  it('reads the US, Canada and UK flags from the question itself', () => {
    expect(ask('Are you legally authorized to work in the United States?', 'NL').resolved.get('q')?.value).toBe('No')
    expect(ask('Are you authorized to work in the U.S.?').resolved.get('q')?.value).toBe('No')
    expect(ask('Are you legally authorized to work in Canada?').resolved.get('q')?.value).toBe('Yes')
    expect(ask('Do you have the right to work in the UK?').resolved.get('q')?.value).toBe('Yes')
  })

  it('does not read "us" in "work for us" as the United States', () => {
    expect(ask('Are you legally authorized to work for us?', 'NL').resolved.get('q')?.value).toBe('Yes')
  })

  it('falls back to the posting country, never the candidate’s home country', () => {
    expect(ask(generic, 'NL').resolved.get('q')?.value).toBe('Yes')
    expect(ask(generic, 'DE').resolved.get('q')?.value).toBe('No')
    expect(ask(generic, 'GB').resolved.get('q')?.value).toBe('Yes')
    expect(ask(generic, 'US').resolved.get('q')?.value).toBe('No')
    expect(ask(generic).declined.has('q')).toBe(true)
  })

  it('declines when the relevant flag was never answered', () => {
    const silent = profile()
    const result = ask('Are you authorized to work in the United States?', undefined, silent)
    expect(result.resolved.has('q')).toBe(false)
    expect(result.declined.get('q')).toMatch(/work authorization/)
  })
})

describe('EU work authorization', () => {
  const eu = field({
    field_id: 'authorized',
    type: 'select',
    label: 'Are you authorized to work in the EU?',
    options: options('Yes', 'No'),
  })
  const answer = (codes: string[], jobCountryCode?: string) =>
    runDeterministic(
      [eu],
      context({
        profile: profile({
          work_authorization: { us: true, canada: false, uk: true, other_country_codes: codes, requires_sponsorship: false },
        }),
        jobCountryCode,
      }),
    ).resolved.get('authorized')?.value

  it('counts any EU member state, not just the posting’s country', () => {
    expect(answer(['DE'], 'NL')).toBe('Yes')
    expect(answer(['DE'])).toBe('Yes')
  })

  it('says No for a candidate authorized only outside the EU', () => {
    expect(answer([], 'BE')).toBe('No')
  })
})

describe('preferences', () => {
  it('answers work setup, job type and salary from the preferences', () => {
    const picky = profile({
      preferences: { job_types: ['contract'], work_setups: ['hybrid', 'remote'], locations: ['Amsterdam'], min_salary: 90000 },
    })
    const fields = [
      field({ field_id: 'ws', type: 'select', label: 'Work arrangement preference', options: options('Remote', 'Hybrid', 'Onsite') }),
      field({ field_id: 'jt', type: 'multi_select', label: 'Desired job type', options: options('Full-time', 'Contract', 'Internship') }),
      field({ field_id: 'sal', type: 'number', label: 'Desired salary' }),
      field({ field_id: 'loc', type: 'text', label: 'Preferred locations' }),
    ]
    const { resolved } = runDeterministic(fields, context({ profile: picky }))
    expect(resolved.get('ws')?.value).toBe('Hybrid')
    expect(resolved.get('jt')?.value).toEqual(['Contract'])
    expect(resolved.get('sal')?.value).toBe(90000)
    expect(resolved.get('loc')?.value).toBe('Amsterdam')
  })

  it('leaves a yes/no onsite commitment to the model', () => {
    const f = field({ field_id: 'q', type: 'radio', label: 'Are you able to work onsite five days a week?', options: options('Yes', 'No') })
    expect(runDeterministic([f], context()).resolved.has('q')).toBe(false)
  })
})

describe('rule matching stays on whole words', () => {
  it('does not mistake look-alike labels for location or start-date fields', () => {
    const fields = [
      field({ field_id: 'q1', type: 'text', label: 'Are you authorized to work in the United States?' }),
      field({ field_id: 'q2', type: 'text', label: 'Personal statement' }),
      field({ field_id: 'q3', type: 'text', label: 'Ethnicity' }),
      field({ field_id: 'q4', type: 'text', label: 'Team capacity you have managed' }),
      field({ field_id: 'q5', type: 'text', label: 'Are you available to work weekends?' }),
    ]
    const { resolved } = runDeterministic(fields, context())
    for (const id of ['q2', 'q3', 'q4', 'q5']) expect(resolved.has(id)).toBe(false)
    expect(resolved.get('q1')?.rule).not.toBe('region')
  })

  it('still maps the real location fields', () => {
    const fields = [
      field({ field_id: 'city', type: 'text', label: 'Current city' }),
      field({ field_id: 'state', type: 'text', label: 'State or region' }),
    ]
    const ctx = context({
      profile: profile({
        location: { ...profile().location, region: 'North Holland' },
      }),
    })
    const { resolved } = runDeterministic(fields, ctx)
    expect(resolved.get('city')?.value).toBe('Amsterdam')
    expect(resolved.get('state')?.value).toBe('North Holland')
  })
})
