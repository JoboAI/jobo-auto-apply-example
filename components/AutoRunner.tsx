'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { advanceApplicationAction, type AdvanceState } from '@/app/actions/applications'
import { btn } from './ui'

/**
 * Drives the synchronous loop from the browser.
 *
 * While the application is open this keeps invoking the advance server action.
 * Each invocation is ONE blocking exchange with Jobo — a long-poll while the
 * agent works, or an answer-and-submit when a step is waiting — so the browser
 * request can be held for minutes at a time. That is the design, not an
 * accident: there is no webhook to receive and nothing to poll, the response
 * IS the next state.
 *
 * Between turns it refreshes the route so the server-rendered inspector shows
 * what just happened, and it stops dead at a terminal status. Errors back off
 * (2s → 30s) and retry: every part of the advance is safe to repeat — reads
 * re-attach, and answers are accepted exactly once per correction round.
 */

const STATUS_LINES: Record<string, string> = {
  creating: 'Re-attaching to the blocking create…',
  queued: 'Queued — holding a connection while a browser session starts…',
  running: 'The agent is working the form — holding a connection for the next step…',
  awaiting_answers: 'Fields received — the answer engine is composing answers…'
}

export function AutoRunner({
  id,
  active,
  autoStart = true,
  startLabel = 'Run'
}: {
  id: string
  /** False once the application is terminal (or never reached Jobo). */
  active: boolean
  /** Start looping on mount; false renders a Run button instead (the notebook). */
  autoStart?: boolean
  startLabel?: string
}) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [state, setState] = useState<AdvanceState | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const loopRef = useRef(false)
  const mountedRef = useRef(true)

  const loop = useCallback(async () => {
    // One loop at a time — a second click or a re-render must not start a
    // parallel chain of blocking requests.
    if (loopRef.current) return
    loopRef.current = true
    setRunning(true)
    setStartedAt(Date.now())

    let delayOnError = 2_000
    try {
      for (;;) {
        if (!mountedRef.current) return
        const next = await advanceApplicationAction(id)
        if (!mountedRef.current) return
        setState(next)
        router.refresh()

        if (next.ok && next.terminal) return
        if (next.ok) {
          delayOnError = 2_000
          continue // straight into the next blocking exchange
        }

        // A dropped connection or a transient API error. Everything in the
        // advance is safe to retry, so back off briefly and re-attach.
        await new Promise((resolve) => setTimeout(resolve, delayOnError))
        delayOnError = Math.min(delayOnError * 2, 30_000)
      }
    } finally {
      loopRef.current = false
      if (mountedRef.current) setRunning(false)
    }
  }, [id, router])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (active && autoStart) void loop()
  }, [active, autoStart, loop])

  // A ticking clock, so the held connection is visibly alive.
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [running])

  if (!active) return null

  if (!running && !autoStart) {
    return (
      <div className="space-y-2">
        <button type="button" onClick={() => void loop()} className={btn('primary')}>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-3 w-3">
            <path d="M8 5v14l11-7z" />
          </svg>
          {startLabel}
        </button>
        {state && !state.ok && (
          <p className="text-xs text-danger-deep">
            {state.code && <code className="mr-1 font-mono">{state.code}</code>}
            {state.error}
          </p>
        )}
      </div>
    )
  }

  const elapsed = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0
  const line = state?.ok
    ? state.status === 'awaiting_answers' && state.stepSequence !== undefined
      ? `Step ${state.stepSequence}${
          state.correctionRound ? ` · correction round ${state.correctionRound}` : ''
        } — answering…`
      : (STATUS_LINES[state.status] ?? `Status: ${state.status}`)
    : state
      ? `Retrying after an error: ${state.error}`
      : 'Holding a connection to Jobo…'

  return (
    <div
      className="flex flex-wrap items-center gap-3 border hairline bg-white px-4 py-3"
      role="status"
      aria-live="polite"
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand" />
      </span>
      <p className={`text-sm ${state && !state.ok ? 'text-warning-deep' : 'text-ink-800'}`}>{line}</p>
      <span className="ml-auto font-mono text-xs tabular-nums text-ink-500">
        {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
      </span>
    </div>
  )
}
