'use client'

import { useState, useTransition } from 'react'
import { updateNotesAction } from '@/app/actions/profiles'
import { btn } from './ui'

/** Freeform notes are the only editable profile data used by the answerer. */

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
