'use client'
import { useCallback, useRef, useState } from 'react'

/**
 * Why this file exists: uncommitted router updates.
 *
 * In this app (Next.js 15.5), a router update started right after a page load
 * or navigation — a server action's revalidatePath, router.refresh(),
 * router.push() or a <Link> click — intermittently renders on the client but
 * never commits: nothing is pending, the server already sent the new data,
 * and the screen just keeps the old state. The bigger the page, the more often
 * it happens. The app is built to tolerate it:
 *
 *  - useBusy (below) instead of useTransition for action buttons, because
 *    isPending stays true until that commit lands.
 *  - pushWithFallback (below) for navigations that follow an action.
 *  - Polling components compare what they rendered with the live state and
 *    reload when a change never appears (components/ApplicationLive.tsx,
 *    components/CardApply.tsx, components/ModeToggle.tsx).
 *  - PageLink (components/PageLink.tsx), a plain <a>, for links on the
 *    busiest pages (the job feed and explorer): a full server-rendered load
 *    instead of a client navigation.
 *
 * If you adopt a Next.js release where this no longer reproduces, these can
 * go back to the framework defaults.
 */

/**
 * "An action is running" as plain state, for buttons that call Server Actions.
 * The flag clears when the action's own promise settles, whatever the router
 * does. Same shape as useTransition, so call sites read `start(async () => …)`.
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
 * router.push (plus a refresh, for pages whose data an action just changed),
 * with a full page load if the result has not landed after a few seconds.
 * By default "landed" means the URL changed; pass `landed` when the page
 * might already be at `href` (for example a mode switch while on /jobs).
 */
export function pushWithFallback(
  router: { push: (href: string) => void; refresh: () => void },
  href: string,
  options: { refresh?: boolean; landed?: () => boolean; afterMs?: number } = {},
) {
  const { refresh = false, afterMs = 4000 } = options
  const target = new URL(href, window.location.href).pathname
  const landed = options.landed ?? (() => window.location.pathname === target)
  router.push(href)
  if (refresh) router.refresh()
  window.setTimeout(() => {
    if (!landed()) window.location.assign(href)
  }, afterMs)
}
