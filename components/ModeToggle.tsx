'use client'
import { useEffect, useRef, useState } from 'react'
import { pushWithFallback, useBusy } from '@/lib/use-busy'
import { useRouter } from 'next/navigation'
import { KeyRound } from 'lucide-react'
import { setModeAction } from '@/app/actions/mode'
import { ApiKeyDialog } from './ApiKeyDialog'
import type { DemoSettings } from '@/lib/user-settings'

export type ModeProps = Pick<
  DemoSettings,
  'mode' | 'hasKey' | 'keyHint' | 'acknowledged' | 'productionAvailable'
>

/**
 * Sandbox | Production switch in the top bar.
 *
 * Production needs the visitor's own Jobo API key: the first switch opens
 * the key dialog (with the one-time "real employers" warning); once a key is
 * connected, switching is a single click either way.
 */
export function ModeToggle(props: ModeProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useBusy()
  const [error, setError] = useState('')
  // The mode on screen, recorded after commit: the refresh below can render
  // the new mode and never commit it (see lib/use-busy.ts).
  const rendered = useRef(props.mode)
  useEffect(() => {
    rendered.current = props.mode
  }, [props.mode])

  const switchTo = (mode: 'sandbox' | 'production') => {
    if (mode === props.mode) return
    if (mode === 'production' && !props.hasKey) {
      setOpen(true)
      return
    }
    start(async () => {
      setError('')
      const result = await setModeAction(mode)
      if (!result.ok) {
        setError(result.error)
        return
      }
      pushWithFallback(router, '/jobs', {
        refresh: true,
        landed: () => rendered.current === mode,
        afterMs: 2500,
      })
    })
  }

  return (
    <div className="mode-control">
      <div
        className="mode-toggle"
        role="group"
        aria-label="Demo mode"
        data-pending={pending || undefined}
      >
        {(['sandbox', 'production'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={props.mode === mode}
            className={props.mode === mode ? 'active' : ''}
            disabled={pending}
            onClick={() => switchTo(mode)}
          >
            <span className={`mode-dot ${mode}`} aria-hidden="true" />
            {mode === 'sandbox' ? 'Sandbox' : 'Production'}
          </button>
        ))}
      </div>
      {props.hasKey && (
        <button
          type="button"
          className="mode-key"
          onClick={() => setOpen(true)}
          aria-label={`Manage Jobo API key ending ${props.keyHint ?? ''}`}
          title="Manage your Jobo API key"
        >
          <KeyRound size={13} />
          <span>···{props.keyHint}</span>
        </button>
      )}
      {error && (
        <span className="mode-error" role="alert">
          {error}
        </span>
      )}
      <ApiKeyDialog
        {...props}
        open={open}
        onClose={() => setOpen(false)}
        onConnected={() => {
          setOpen(false)
          pushWithFallback(router, '/jobs', {
            refresh: true,
            landed: () => rendered.current === 'production',
          })
        }}
      />
    </div>
  )
}
