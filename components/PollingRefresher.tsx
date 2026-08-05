'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

/**
 * Refreshes the page while an application is still open.
 *
 * Polling rather than SSE or websockets, deliberately: the webhook already
 * gives us push for every interesting moment, and everything else moves on the
 * scale of tens of seconds. A realtime channel would be the biggest complexity
 * increase in the app for the smallest gain.
 *
 * Three things keep it cheap — back off 2s → 5s → 10s, stop dead on a terminal
 * status, and pause entirely when the tab is hidden. Auto Apply reads are not
 * credit-metered but they are rate-limited per key.
 */
export function PollingRefresher({ active }: { active: boolean }) {
  const router = useRouter()
  const delayRef = useRef(2_000)

  useEffect(() => {
    if (!active) return

    let timer: ReturnType<typeof setTimeout>
    let cancelled = false

    const tick = () => {
      if (cancelled) return
      if (document.visibilityState === 'visible') {
        router.refresh()
        delayRef.current = Math.min(delayRef.current * 1.6, 10_000)
      }
      timer = setTimeout(tick, delayRef.current)
    }

    timer = setTimeout(tick, delayRef.current)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [active, router])

  return null
}
