import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeneratedAnswer } from '@/lib/answers/schema'
import type { AnswerContext } from '@/lib/answers/types'
import { emptyProfile } from '@/lib/resume/profile-schema'
import { field } from './helpers'

const generateAnswers = vi.hoisted(() => vi.fn())
vi.mock('@/lib/answers/llm', () => ({ generateAnswers }))
const { buildAnswers } = await import('@/lib/answers')
const { slotValue } = await import('@/lib/answers/schema')

function context(): AnswerContext {
  return {
    profile: emptyProfile('Ada Lovelace', 'ada@example.com'),
    resumeUrl: null,
    resumeFilename: 'resume.pdf',
    resumeContentType: 'application/pdf',
    resumeText: 'Ada Lovelace, software engineer.',
    applyUrl: 'https://jobs.example.com/apply/1',
    commandErrors: [],
    correctionRound: 0,
    previousAnswers: [],
    budgetMs: 90_000,
  }
}

function answer(overrides: Partial<GeneratedAnswer> & { field_id: string }): GeneratedAnswer {
  return {
    kind: 'text',
    text: null,
    number: null,
    boolean: null,
    strings: null,
    typeahead: null,
    confidence: 1,
    reasoning: 'From the profile.',
    ...overrides,
  }
}

function reply(...answers: GeneratedAnswer[]) {
  return {
    answers: new Map(answers.map((a) => [a.field_id, a])),
    model: 'deepseek/deepseek-v4-flash-0731',
    elapsedMs: 10,
  }
}

const years = field({
  field_id: 'years',
  type: 'number',
  label: 'Years of experience',
  requires_answer: true,
})
const school = field({
  field_id: 'school',
  type: 'typeahead',
  label: 'School search',
  requires_answer: true,
})

beforeEach(() => generateAnswers.mockReset())

describe('slotValue', () => {
  it('uses the filled slot when the model declared a different kind', () => {
    expect(
      slotValue(answer({ field_id: 'school', kind: 'typeahead', text: 'Oxford University' })),
    ).toBe('Oxford University')
  })

  it('still returns nothing for a skip', () => {
    expect(slotValue(answer({ field_id: 'school', kind: 'skip', text: 'x' }))).toBeUndefined()
  })
})

describe('required fields the model fumbles', () => {
  it('asks again for a required field the model left out of its output', async () => {
    generateAnswers
      .mockResolvedValueOnce(reply())
      .mockResolvedValueOnce(reply(answer({ field_id: 'years', kind: 'number', number: 6 })))

    const result = await buildAnswers([years], context())

    expect(generateAnswers).toHaveBeenCalledTimes(2)
    expect(generateAnswers.mock.calls[1][0]).toEqual([years])
    expect(result.unanswerable).toEqual([])
    expect(result.answers).toEqual([{ field_id: 'years', value: 6 }])
    expect(result.llmMs).toBe(20)
    // One trace entry per field, from the pass that answered it.
    expect(result.trace).toEqual([expect.objectContaining({ field_id: 'years', source: 'llm' })])
  })

  it('reports a field still broken after the retry as a model failure, not a profile gap', async () => {
    const empty = answer({ field_id: 'school', kind: 'typeahead' })
    generateAnswers.mockResolvedValue(reply(empty))

    const result = await buildAnswers([school], context())

    expect(generateAnswers).toHaveBeenCalledTimes(2)
    expect(result.unanswerable).toEqual([school])
    expect(result.modelFailures).toEqual([school])
    expect(result.trace).toEqual([
      expect.objectContaining({ field_id: 'school', source: 'dropped' }),
    ])
  })

  it('does not ask again for a field the model deliberately skipped', async () => {
    generateAnswers.mockResolvedValue(reply(answer({ field_id: 'years', kind: 'skip' })))

    const result = await buildAnswers([years], context())

    expect(generateAnswers).toHaveBeenCalledTimes(1)
    expect(result.unanswerable).toEqual([years])
    expect(result.modelFailures).toEqual([])
  })
})
