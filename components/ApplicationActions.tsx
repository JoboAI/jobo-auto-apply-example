'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { cancelApplicationAction, syncApplicationAction } from '@/app/actions/applications'
import { btn } from './ui'

export function ApplicationActions({ id, cancelable }: { id: string; cancelable: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-danger-deep">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await syncApplicationAction(id)
            if (!result.ok) setError(result.error ?? 'Sync failed')
            router.refresh()
          })
        }
        className={btn('secondary', 'sm')}
      >
        Sync
      </button>
      {cancelable && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await cancelApplicationAction(id)
              if (!result.ok) setError(result.error ?? 'Cancel failed')
              router.refresh()
            })
          }
          className={btn('secondary', 'sm')}
        >
          Cancel
        </button>
      )}
    </div>
  )
}
