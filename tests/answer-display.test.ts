import { describe, expect, it } from 'vitest'
import { displayAnswer } from '@/lib/answer-display'
import { field, group, itemField } from './helpers'

describe('recorded answer display', () => {
  it('preserves actual choice values alongside readable labels', () => {
    const f = field({
      field_id: 'workplace',
      type: 'multi_select',
      options: [{ value: 'r', label: 'Remote' }],
    })
    expect(displayAnswer(['r', 'other'], f)).toBe('Remote (r)\nother')
    expect(displayAnswer(false)).toBe('No (false)')
    expect(displayAnswer(0)).toBe('0')
    expect(displayAnswer(null)).toBe('No value')
  })
  it('shows resume filenames without exposing signed download URLs', () => {
    const file = {
      filename: 'resume.pdf',
      url: 'https://demo.jobo.world/api/application-resumes/id?token=private',
    }
    expect(displayAnswer(file, field({ field_id: 'cv', type: 'file' }))).toBe('resume.pdf')
    expect(displayAnswer(file)).not.toContain('private')
  })
  it('labels repeating-group entries and nested file answers', () => {
    const f = group('work', 'work_experience', [
      itemField('company', { label: 'Employer' }),
      itemField('attachment', { type: 'file', label: 'Evidence' }),
    ])
    const answer = [
      {
        company: 'Example',
        attachment: { filename: 'evidence.pdf', url: 'https://example.com/private' },
      },
    ]
    expect(displayAnswer(answer, f)).toBe('Entry 1\nEmployer: Example\nEvidence: evidence.pdf')
  })
})
