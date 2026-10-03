'use client'
import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, KeyRound, TriangleAlert, X } from 'lucide-react'
import { connectProductionAction, forgetApiKeyAction } from '@/app/actions/mode'
import { useBusy } from '@/lib/use-busy'
import type { ModeProps } from './ModeToggle'

/**
 * Connect, replace or disconnect the visitor's own Jobo API key for
 * production mode. The first time, it also asks the visitor to accept that
 * applications go to real employers. The key is verified with Jobo before it
 * is stored (app/actions/mode.ts).
 */
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
            Production mode is not enabled on this deployment, so only sandbox jobs are available
            here.
          </p>
        ) : (
          <>
            <p>
              Production mode searches the live Jobo catalog — only jobs on ATSes Auto Apply
              supports — and runs every application on your key, in your Jobo account.
            </p>
            {hasKey && (
              <p className="key-dialog-current">
                Connected key ending <strong>{keyHint}</strong>. Paste a new key to replace it.
              </p>
            )}
            {!acknowledged && (
              <div className="notice warning key-dialog-warning">
                <TriangleAlert size={18} />
                <div>
                  <strong>These are real applications.</strong> Clicking Apply submits your profile
                  to a real employer under your Jobo account. Job searches use your key’s credits.
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
                Stored encrypted so applications can finish in the background. Disconnecting deletes
                it.
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
                        try {
                          await forgetApiKeyAction()
                        } catch {
                          setError('Could not disconnect the key. Please try again.')
                          return
                        }
                        onClose()
                        // Back to sandbox: a full load, as the header and feed both change.
                        window.location.assign('/jobs')
                      })
                    }
                  >
                    Disconnect key
                  </button>
                )}
                <button className="button primary" disabled={pending || (!acknowledged && !agreed)}>
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
