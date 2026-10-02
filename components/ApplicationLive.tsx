'use client'
import { useEffect, useRef, useState } from 'react'
import { useBusy } from '@/lib/use-busy'
import { useRouter } from 'next/navigation'
import { cancelApplicationAction } from '@/app/actions/applications'
const POLL_MS = 3000
/** Polls in a row with the same unrendered change before falling back to a reload. */
const STUCK_POLLS = 3

/**
 * Keeps the page current while the worker runs.
 *
 * It polls a small status endpoint and calls router.refresh() only when the
 * server has something the page does not show yet. Polling alone used to
 * leave the page stuck: after a cancel, Next's refreshes fetched the new
 * state but intermittently never committed it, so "Queued" stayed on screen
 * until a manual reload. Comparing the rendered fingerprint with the live one
 * detects that, and a full reload recovers.
 */
export function LiveRefresh({
  id,
  active,
  version,
}: {
  /** Omitted on list pages, which just re-render every few seconds. */
  id?: string
  active: boolean
  version?: string
}) {
  const router = useRouter()
  // Updated in an effect, not during render: React can render a refreshed
  // tree and then never commit it (the very failure this guards against), and
  // a ref written during that render would claim the change is on screen.
  const rendered = useRef(version)
  useEffect(() => {
    rendered.current = version
  }, [version])
  useEffect(() => {
    if (!active) return
    if (!id) {
      const timer = setInterval(() => router.refresh(), 5000)
      return () => clearInterval(timer)
    }
    let pending: string | null = null
    let polls = 0
    let busy = false
    const timer = setInterval(async () => {
      if (busy || document.visibilityState === 'hidden') return
      busy = true
      try {
        const response = await fetch(`/api/applications/${id}/live`, { cache: 'no-store' })
        if (!response.ok) return
        const live = (await response.json()) as { version: string }
        if (live.version === rendered.current) {
          pending = null
          polls = 0
          return
        }
        if (live.version !== pending) {
          // A new change: ask Next to re-render the page.
          pending = live.version
          polls = 1
          router.refresh()
        } else if (++polls >= STUCK_POLLS) {
          // The same change was refreshed and still is not on screen.
          window.location.reload()
        }
      } catch {
        // Offline or restarting; the next poll tries again.
      } finally {
        busy = false
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [active, id, router])
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
  const [pending, start] = useBusy(),
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
