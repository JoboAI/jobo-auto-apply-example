'use client'
import { useCallback, useRef, useState } from 'react'

/**
 * "An action is running" as plain state, for buttons that call Server Actions.
 *
 * Not useTransition: its isPending stays true until React commits the router
 * update the action triggers (revalidatePath re-renders the current page), and
 * in this app that commit intermittently never lands when an action fires
 * right after a page load or navigation — the profile editor sat on
 * "Saving…" for good although the save had finished in milliseconds. This
 * flag clears when the action's own promise settles, whatever the router does.
 *
 * Same shape as useTransition, so call sites read `start(async () => …)`.
 */
export function useBusy() {
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const start = useCallback(async (task: () => Promise<void>) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      await task()
    } finally {
      running.current = false
      setBusy(false)
    }
  }, [])
  return [busy, start] as const
}

/**
 * router.push, with a full page load if the client-side navigation has not
 * landed after a few seconds — the same uncommitted-router-update failure as
 * above, applied to the navigations that follow an action.
 */
export function pushWithFallback(
  router: { push: (href: string) => void },
  href: string,
  afterMs = 4000,
) {
  router.push(href)
  const target = new URL(href, window.location.href).pathname
  window.setTimeout(() => {
    if (window.location.pathname !== target) window.location.assign(href)
  }, afterMs)
}
