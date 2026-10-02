import { describe, expect, it } from 'vitest'
import type { FieldOption } from '@jobo-ai/autoapply'
import { classifyEeo, resolveSensitive } from '@/lib/answers/eeo'
import { emptyProfile, type EeoAnswers, type ResumeProfile } from '@/lib/resume/profile-schema'
import { field } from './helpers'

/**
 * Self-identification mapping against the option wording real ATSs use.
 * The rule under test: answer exactly from the candidate's own answers, and
 * fall back to the form's decline option whenever that is not possible.
 */

function who(eeo: Partial<EeoAnswers>): ResumeProfile {
  const profile = emptyProfile('Ada Lovelace', 'ada@example.com')
  return { ...profile, eeo: { ...profile.eeo, ...eeo } }
}

const opts = (...labels: string[]): FieldOption[] =>
  labels.map((label, i) => ({ value: String(i + 1), label }))

const sensitive = (label: string, options: FieldOption[], type: 'select' | 'multi_select' | 'radio' = 'select') =>
  field({ field_id: label.toLowerCase().replace(/\W+/g, '_'), type, label, sensitive: true, options })

const answer = (f: ReturnType<typeof sensitive>, profile: ResumeProfile) => {
  const value = resolveSensitive(f, profile).value
  const pick = (v: unknown) => f.type !== 'checkbox' && 'options' in f
    ? f.options?.find((o) => o.value === v)?.label
    : v
  return Array.isArray(value) ? value.map(pick) : pick(value)
}

// Greenhouse's US EEOC block (the two-question race/ethnicity format).
const greenhouse = {
  gender: sensitive('Gender', opts('Male', 'Female', 'Decline To Self Identify')),
  hispanic: sensitive('Are you Hispanic/Latino?', opts('Yes', 'No', 'Decline To Self Identify')),
  race: sensitive('Race', opts(
    'American Indian or Alaskan Native', 'Asian', 'Black or African American',
    'Hispanic or Latino', 'White', 'Native Hawaiian or Other Pacific Islander',
    'Two or More Races', 'Decline To Self Identify',
  )),
  veteran: sensitive('Veteran Status', opts(
    'I am not a protected veteran',
    'I identify as one or more of the classifications of protected veteran',
    "I don't wish to answer",
  )),
  disability: sensitive('Disability Status', opts(
    'Yes, I have a disability, or have had one in the past',
    'No, I do not have a disability and have not had one in the past',
    'I do not want to answer',
  )),
}

describe('classifying self-identification questions', () => {
  it.each([
    ['Gender', 'gender'],
    ['What is your gender identity?', 'gender'],
    ['Sex', 'gender'],
    ['Do you identify as transgender?', 'transgender'],
    ['Is your gender identity the same as the sex you were assigned at birth?', 'transgender'],
    ['Sexual orientation', 'sexual_orientation'],
    ['Do you identify as LGBTQ+?', 'lgbtq'],
    ['Are you Hispanic/Latino?', 'hispanic'],
    ['Hispanic or Latino ethnicity', 'hispanic'],
    ['Race', 'race'],
    ['Race/Ethnicity', 'race'],
    ['Please identify your race (Hispanic or Latino is asked separately)', 'race'],
    ['Veteran Status', 'veteran'],
    ['Disability Status', 'disability'],
    ['Pronouns', 'pronouns'],
  ])('%s → %s', (label, kind) => {
    expect(classifyEeo(field({ field_id: 'x', type: 'select', label }))).toBe(kind)
  })
})

describe('Greenhouse US EEOC', () => {
  it('maps every question from explicit answers', () => {
    const ada = who({ gender: 'female', ethnicity: ['white'], veteran: 'no', disability: 'no', lgbtq: 'no' })
    expect(answer(greenhouse.gender, ada)).toBe('Female')
    expect(answer(greenhouse.hispanic, ada)).toBe('No')
    expect(answer(greenhouse.race, ada)).toBe('White')
    expect(answer(greenhouse.veteran, ada)).toBe('I am not a protected veteran')
    expect(answer(greenhouse.disability, ada)).toBe('No, I do not have a disability and have not had one in the past')
  })

  it('answers yes the way the federal wording asks it', () => {
    const vet = who({ veteran: 'yes', disability: 'yes' })
    expect(answer(greenhouse.veteran, vet)).toBe('I identify as one or more of the classifications of protected veteran')
    expect(answer(greenhouse.disability, vet)).toBe('Yes, I have a disability, or have had one in the past')
  })

  it('collapses the Asian sub-groups and handles several identities', () => {
    expect(answer(greenhouse.race, who({ ethnicity: ['south_asian'] }))).toBe('Asian')
    expect(answer(greenhouse.race, who({ ethnicity: ['east_asian', 'white'] }))).toBe('Two or More Races')
    // EEO-1: Hispanic or Latino is the answer whenever it applies.
    expect(answer(greenhouse.race, who({ ethnicity: ['hispanic_latinx', 'white'] }))).toBe('Hispanic or Latino')
    expect(answer(greenhouse.hispanic, who({ ethnicity: ['hispanic_latinx', 'white'] }))).toBe('Yes')
  })

  it('counts Middle Eastern as White when the form has no category for it', () => {
    expect(answer(greenhouse.race, who({ ethnicity: ['middle_eastern'] }))).toBe('White')
  })

  it('declines everything for a candidate who declined', () => {
    const declined = who({ gender: 'decline', ethnicity: ['decline'], veteran: 'decline', disability: 'decline', lgbtq: 'decline' })
    expect(answer(greenhouse.gender, declined)).toBe('Decline To Self Identify')
    expect(answer(greenhouse.hispanic, declined)).toBe('Decline To Self Identify')
    expect(answer(greenhouse.race, declined)).toBe('Decline To Self Identify')
    expect(answer(greenhouse.veteran, declined)).toBe("I don't wish to answer")
    expect(answer(greenhouse.disability, declined)).toBe('I do not want to answer')
  })

  it('declines when an answer has no exact option rather than picking a near one', () => {
    expect(answer(greenhouse.gender, who({ gender: 'non_binary' }))).toBe('Decline To Self Identify')
    // Unanswered is not "no".
    expect(answer(greenhouse.veteran, who({}))).toBe("I don't wish to answer")
  })
})

describe('Lever and Workday wording', () => {
  const leverRace = sensitive('Race', opts(
    'White (Not Hispanic or Latino)',
    'Black or African American (Not Hispanic or Latino)',
    'Hispanic or Latino',
    'Asian (Not Hispanic or Latino)',
    'Two or More Races (Not Hispanic or Latino)',
    'Decline to self-identify',
  ))

  it('does not read "Not Hispanic or Latino" as Hispanic', () => {
    expect(answer(leverRace, who({ ethnicity: ['white'] }))).toBe('White (Not Hispanic or Latino)')
    expect(answer(leverRace, who({ ethnicity: ['hispanic_latinx'] }))).toBe('Hispanic or Latino')
    expect(answer(leverRace, who({ ethnicity: ['black_african_american', 'white'] }))).toBe('Two or More Races (Not Hispanic or Latino)')
  })

  it('maps Workday veteran wording, skipping the not-protected veteran', () => {
    const workday = sensitive('Please select the veteran status which most accurately describes your status', opts(
      'I am not a veteran',
      'I am a veteran, but I am not a protected veteran',
      'I identify as one or more of the classifications of protected veteran listed above',
      'I do not wish to self-identify',
    ))
    expect(answer(workday, who({ veteran: 'no' }))).toBe('I am not a veteran')
    expect(answer(workday, who({ veteran: 'yes' }))).toBe('I identify as one or more of the classifications of protected veteran listed above')
  })

  it('maps Man/Woman gender wording without crossing them', () => {
    const gender = sensitive('Gender', opts('Woman', 'Man', 'Non-binary', 'Transgender man', 'Prefer not to say'))
    expect(answer(gender, who({ gender: 'male' }))).toBe('Man')
    expect(answer(gender, who({ gender: 'female' }))).toBe('Woman')
    expect(answer(gender, who({ gender: 'non_binary' }))).toBe('Non-binary')
  })

  it('selects every identity on a multi-select', () => {
    const multi = sensitive('Ethnicity', opts('Black', 'East Asian', 'Southeast Asian', 'White', 'Prefer not to say'), 'multi_select')
    expect(answer(multi, who({ ethnicity: ['southeast_asian', 'white'] }))).toEqual(['Southeast Asian', 'White'])
    expect(answer(multi, who({ ethnicity: ['decline'] }))).toEqual(['Prefer not to say'])
  })
})

describe('narrower questions', () => {
  it('answers sexual orientation only from a "no" to LGBTQ+', () => {
    const orientation = sensitive('Sexual orientation', opts('Heterosexual/Straight', 'Gay', 'Lesbian', 'Bisexual', 'Prefer not to say'))
    expect(answer(orientation, who({ lgbtq: 'no' }))).toBe('Heterosexual/Straight')
    expect(answer(orientation, who({ lgbtq: 'yes' }))).toBe('Prefer not to say')
  })

  it('never answers a transgender question', () => {
    const trans = sensitive('Do you identify as transgender?', opts('Yes', 'No', 'Prefer not to say'))
    expect(answer(trans, who({ gender: 'female', lgbtq: 'no' }))).toBe('Prefer not to say')
  })

  it('derives pronouns from gender', () => {
    const pronouns = sensitive('Pronouns', opts('He/Him', 'She/Her', 'They/Them', 'Prefer not to say'))
    expect(answer(pronouns, who({ gender: 'female' }))).toBe('She/Her')
    expect(answer(pronouns, who({ gender: 'decline' }))).toBe('Prefer not to say')
  })

  it('answers LGBTQ+ yes/no questions', () => {
    const lgbtq = sensitive('Do you identify as LGBTQ+?', opts('Yes', 'No', 'I prefer not to answer'), 'radio')
    expect(answer(lgbtq, who({ lgbtq: 'yes' }))).toBe('Yes')
    expect(answer(lgbtq, who({ lgbtq: 'no' }))).toBe('No')
  })
})

describe('no decline option', () => {
  it('leaves the field unanswered rather than inventing an answer', () => {
    const strict = sensitive('Gender', opts('Male', 'Female'))
    expect(resolveSensitive(strict, who({ gender: 'non_binary' })).value).toBeUndefined()
    expect(resolveSensitive(strict, who({ gender: 'male' })).value).toBe('1')
  })
})
