'use client'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cancelApplicationAction } from '@/app/actions/applications'
export function LiveRefresh({ active }: { active: boolean }) {
  const router = useRouter()
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => router.refresh(), 5000)
    return () => clearInterval(timer)
  }, [active, router])
  return active ? (
    <span className="live-label">
      <span />
      Updates automatically
    </span>
  ) : null
}
export function CancelButton({
  id,
  requested,
}: {
  id: string
  requested: boolean
}) {
  const [pending, start] = useTransition(),
    [error, setError] = useState(''),
    router = useRouter()
  return (
    <div>
      <button
        disabled={pending || requested}
        className="button secondary"
        onClick={() =>
          start(async () => {
            try {
              const r = await cancelApplicationAction(id)
              if (!r.ok) setError(r.error ?? 'Please try again.')
              router.refresh()
            } catch {
              setError('Could not cancel. Please try again.')
            }
          })
        }
      >
        {requested
          ? 'Canceling safely…'
          : pending
            ? 'Requesting cancellation…'
            : 'Cancel application'}
      </button>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </div>
  )
}
