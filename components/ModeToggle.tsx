'use client'
import { useEffect, useRef, useState } from 'react'
import { useBusy } from '@/lib/use-busy'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, KeyRound, TriangleAlert, X } from 'lucide-react'
import {
  connectProductionAction,
  forgetApiKeyAction,
  setModeAction,
} from '@/app/actions/mode'
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
      router.push('/jobs')
      router.refresh()
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
          router.push('/jobs')
          router.refresh()
        }}
      />
    </div>
  )
}

export function ApiKeyDialog({
  open,
  onClose,
  onConnected,
  hasKey,
  keyHint,
  acknowledged,
  productionAvailable,
}: ModeProps & {
  open: boolean
  onClose: () => void
  onConnected: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  const [pending, start] = useBusy()
  const [error, setError] = useState('')
  const [agreed, setAgreed] = useState(false)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      setError('')
      dialog.showModal()
    } else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="key-dialog"
      aria-labelledby="key-dialog-title"
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="key-dialog-body">
        <div className="spread">
          <span className="eyebrow">
            <KeyRound size={14} /> PRODUCTION MODE
          </span>
          <button
            type="button"
            className="icon-button key-dialog-close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        <h2 id="key-dialog-title">
          {hasKey ? 'Your Jobo API key' : 'Apply to real jobs with your API key'}
        </h2>
        {!productionAvailable ? (
          <p>
            Production mode is not configured on this deployment. Set
            API_KEY_ENCRYPTION_SECRET to let visitors connect their own key.
          </p>
        ) : (
          <>
            <p>
              Production mode searches the live Jobo catalog — only jobs on
              ATSes Auto Apply supports — and runs every application on your
              key, in your Jobo account.
            </p>
            {hasKey && (
              <p className="key-dialog-current">
                Connected key ending <strong>{keyHint}</strong>. Paste a new
                key to replace it.
              </p>
            )}
            {!acknowledged && (
              <div className="notice warning key-dialog-warning">
                <TriangleAlert size={18} />
                <div>
                  <strong>These are real applications.</strong> Clicking Apply
                  submits your profile to a real employer under your Jobo
                  account. Job searches use your key’s credits.
                  <label className="key-dialog-check">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                    />
                    I understand
                  </label>
                </div>
              </div>
            )}
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault()
                const apiKey = String(new FormData(e.currentTarget).get('apiKey') ?? '')
                start(async () => {
                  setError('')
                  try {
                    const result = await connectProductionAction({
                      apiKey,
                      acknowledged: acknowledged || agreed,
                    })
                    if (!result.ok) setError(result.error)
                    else onConnected()
                  } catch {
                    setError('Could not connect. Please try again.')
                  }
                })
              }}
            >
              <label>
                Jobo API key
                <input
                  name="apiKey"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="jbe_live_…"
                  required
                />
              </label>
              <a
                className="text-link"
                href="https://enterprise.jobo.world/api-keys"
                target="_blank"
                rel="noopener noreferrer"
              >
                Get a key in the Jobo dashboard <ArrowUpRight size={14} />
              </a>
              <small>
                Stored encrypted so applications can finish in the background.
                Disconnecting deletes it.
              </small>
              {error && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
              <div className="key-dialog-actions">
                {hasKey && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        await forgetApiKeyAction()
                        onClose()
                        router.push('/jobs')
                        router.refresh()
                      })
                    }
                  >
                    Disconnect key
                  </button>
                )}
                <button
                  className="button primary"
                  disabled={pending || (!acknowledged && !agreed)}
                >
                  {pending ? 'Checking key…' : hasKey ? 'Replace key' : 'Connect and switch'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </dialog>
  )
}

/** Settings-page panel: same dialog, plus status. */
export function ProductionKeySettings(props: ModeProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <section className="surface settings-card">
      <h2>Production mode</h2>
      <p className="subtle">
        {props.hasKey
          ? `Jobo API key ending ${props.keyHint} is connected. You are in ${props.mode} mode.`
          : 'Connect your own Jobo API key to search real jobs and apply to them.'}
      </p>
      <button type="button" className="button secondary" onClick={() => setOpen(true)}>
        <KeyRound size={15} /> {props.hasKey ? 'Manage API key' : 'Connect API key'}
      </button>
      <ApiKeyDialog
        {...props}
        open={open}
        onClose={() => setOpen(false)}
        onConnected={() => {
          setOpen(false)
          router.refresh()
        }}
      />
    </section>
  )
}
