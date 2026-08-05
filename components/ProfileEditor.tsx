'use client'

import { useState, useTransition } from 'react'
import { updateEeoAction, updateNotesAction } from '@/app/actions/profiles'
import type { EeoAnswers } from '@/lib/resume/profile-schema'
import { btn } from './ui'

/**
 * The two editable parts of a profile.
 *
 * Everything else is derived from the resume and displayed read-only — these
 * two are the ones a human has to supply, and they are the ones that change
 * outcomes:
 *
 *   `freeform_notes` is what open-ended questions ("why do you want to work
 *   here?") are actually answered from. A resume does not contain that.
 *
 *   `eeo` is voluntary self-identification. It is only ever set here, by hand.
 *   Neither the resume parser nor the answer model ever populates it — Jobo
 *   marks those fields `sensitive: true` and never infers them, and an example
 *   that fabricated demographic data to get past a form would be teaching
 *   precisely the wrong thing.
 */

export function NotesEditor({ profileId, initial }: { profileId: string; initial: string }) {
  const [value, setValue] = useState(initial)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  return (
    <div>
      <label htmlFor="notes" className="block text-sm font-medium text-ink-800">
        Anything else the AI should know when answering open questions
      </label>
      <p className="mt-1 text-xs text-ink-600">
        Motivation, constraints, the kind of role you want, things a resume cannot say. This is the
        single highest-leverage field in the app.
      </p>
      <textarea
        id="notes"
        value={value}
        rows={6}
        onChange={(event) => {
          setValue(event.target.value)
          setSaved(false)
        }}
        className="field mt-3"
        placeholder="I'm looking for a senior backend role on a small team. I care about…"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await updateNotesAction(profileId, value)
              setSaved(true)
            })
          }
          className={btn('primary', 'sm')}
        >
          {pending ? 'Saving…' : 'Save notes'}
        </button>
        {saved && <span className="text-xs text-success-deep">Saved</span>}
      </div>
    </div>
  )
}

const EEO_FIELDS: { key: keyof EeoAnswers; label: string }[] = [
  { key: 'gender', label: 'Gender' },
  { key: 'race_ethnicity', label: 'Race / ethnicity' },
  { key: 'hispanic_or_latino', label: 'Hispanic or Latino' },
  { key: 'veteran_status', label: 'Veteran status' },
  { key: 'disability_status', label: 'Disability status' }
]

export function EeoEditor({ profileId, initial }: { profileId: string; initial: EeoAnswers }) {
  const [value, setValue] = useState<EeoAnswers>(initial)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  return (
    <div>
      <p className="text-xs text-ink-600">
        Entirely optional. Left blank, this app selects the form&apos;s own &ldquo;prefer not to
        say&rdquo; option when one exists, and otherwise leaves the field unanswered. These values
        are never sent to the language model.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {EEO_FIELDS.map((field) => (
          <label key={field.key} className="block text-sm">
            <span className="font-medium text-ink-800">{field.label}</span>
            <input
              type="text"
              value={value[field.key] ?? ''}
              onChange={(event) => {
                setValue({ ...value, [field.key]: event.target.value || null })
                setSaved(false)
              }}
              className="field mt-1"
              placeholder="Leave blank to decline"
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await updateEeoAction(profileId, value)
              setSaved(true)
            })
          }
          className={btn('secondary', 'sm')}
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-xs text-success-deep">Saved</span>}
      </div>
    </div>
  )
}
