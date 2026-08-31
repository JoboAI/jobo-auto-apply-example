import { describe, expect, it } from 'vitest'
import { buildAnswers } from '@/lib/answers'
import { buildUserPrompt } from '@/lib/answers/prompt'
import type { AnswerContext } from '@/lib/answers/types'
import { emptyProfile } from '@/lib/resume/profile-schema'
import { field } from './helpers'

function context(overrides: Partial<AnswerContext> = {}): AnswerContext {
  return {
    profile: emptyProfile('Ada Lovelace', 'ada@example.com'),
    resumeUrl: 'https://example.com/resume.pdf',
    resumeFilename: 'resume.pdf',
    resumeContentType: 'application/pdf',
    resumeText: 'Ada Lovelace, software engineer.',
    applyUrl: 'https://jobs.example.com/apply/1',
    commandErrors: [],
    correctionRound: 0,
    previousAnswers: [],
    budgetMs: 0,
    ...overrides
  }
}

describe('LLM safety boundaries', () => {
  it('omits excluded sensitive correction values, labels, and errors from the prompt', () => {
    const safe = field({
      field_id: 'motivation',
      type: 'textarea',
      label: 'Why do you want this role?',
      required: true,
      requires_answer: true
    })
    const sensitiveId = 'private-demographic-field'
    const sensitiveLabel = 'SECRET DEMOGRAPHIC LABEL'
    const sensitiveValue = 'SECRET DEMOGRAPHIC VALUE'
    const sensitiveError = `ATS rejected ${sensitiveLabel}`

    const prompt = buildUserPrompt({
      fields: [safe],
      gaps: [],
      ctx: context({
        correctionRound: 1,
        previousAnswers: [
          { field_id: safe.field_id, value: 'old safe answer' },
          { field_id: sensitiveId, value: sensitiveValue }
        ],
        commandErrors: [
          {
            field_id: safe.field_id,
            item_index: null,
            field_key: null,
            code: 'max_length',
            message: 'The safe answer was too long.'
          },
          {
            field_id: sensitiveId,
            item_index: null,
            field_key: null,
            code: 'invalid_option',
            message: sensitiveError
          },
          {
            field_id: null,
            item_index: null,
            field_key: null,
            code: 'sensitive-global-error',
            message: 'SECRET GLOBAL ERROR'
          }
        ]
      })
    })

    expect(prompt).toContain('old safe answer')
    expect(prompt).toContain('The safe answer was too long.')
    expect(prompt).not.toContain(sensitiveId)
    expect(prompt).not.toContain(sensitiveLabel)
    expect(prompt).not.toContain(sensitiveValue)
    expect(prompt).not.toContain(sensitiveError)
    expect(prompt).not.toContain('SECRET GLOBAL ERROR')
  })

  it('never carries a previous sensitive answer past a deterministic decline', async () => {
    const sensitive = field({
      field_id: 'voluntary-demographic',
      type: 'select',
      label: 'Voluntary demographic question',
      sensitive: true,
      options: [{ value: 'group-a', label: 'Group A' }]
    })
    const previousValue = 'SECRET PREVIOUS DEMOGRAPHIC ANSWER'

    const result = await buildAnswers([sensitive], context({
      correctionRound: 1,
      previousAnswers: [{ field_id: sensitive.field_id, value: previousValue }]
    }))

    expect(result.answers).toEqual([])
    expect(result.trace).toContainEqual(expect.objectContaining({
      field_id: sensitive.field_id,
      source: 'declined'
    }))
    expect(JSON.stringify(result)).not.toContain(previousValue)
    expect(result.trace.some((entry) => entry.source === 'previous_round')).toBe(false)
  })
})
