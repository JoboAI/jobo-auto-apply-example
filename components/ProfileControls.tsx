'use client'
import { useState } from 'react'
import { useBusy } from '@/lib/use-busy'
import { useRouter } from 'next/navigation'
import { setDefaultProfileAction, deleteProfileAction } from '@/app/actions/profiles'
export function ProfileControls({ id, isDefault }: { id: string; isDefault: boolean }) {
  const [pending, start] = useBusy(),
    [error, setError] = useState(''),
    router = useRouter()
  const run = (action: () => Promise<{ ok: boolean }>) =>
    start(async () => {
      try {
        const r = await action()
        if (!r.ok) setError('Could not update resume.')
        else router.refresh()
      } catch {
        setError('Please try again.')
      }
    })
  return (
    <div className="profile-controls">
      {!isDefault && (
        <button
          className="text-link"
          disabled={pending}
          onClick={() => run(() => setDefaultProfileAction(id))}
        >
          Make default
        </button>
      )}
      <button
        className="text-link muted"
        disabled={pending}
        onClick={() => {
          if (
            window.confirm(
              'Remove this resume from your profile? Existing applications keep their saved copy.',
            )
          )
            run(() => deleteProfileAction(id))
        }}
      >
        Remove
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  )
}
