'use client'
import { useState } from 'react'
import { ArrowUpRight, TriangleAlert } from 'lucide-react'
import { connectApiKeyAction } from '@/app/actions/api-key'
import { API_KEYS_URL } from '@/lib/presentation'
import { useBusy } from '@/lib/use-busy'

/** A production key: any Jobo key that is not a sandbox (jbe_test_) one. */
function isProductionKey(value: string): boolean {
  const key = value.trim()
  return key.startsWith('jbe_') && !key.startsWith('jbe_test_')
}

/**
 * Connect or replace the visitor's own Jobo API key. Its prefix picks the
 * environment; a production key first needs the one-time "real employers"
 * confirmation. The key is verified with Jobo before it is stored
 * (app/actions/api-key.ts).
 */
export function ApiKeyForm({
  acknowledged,
  submitLabel,
  onConnected,
  children,
}: {
  acknowledged: boolean
  submitLabel: string
  onConnected: () => void
  /** Extra actions beside the submit button. */
  children?: React.ReactNode
}) {
  const [pending, start] = useBusy()
  const [error, setError] = useState('')
  const [key, setKey] = useState('')
  const [agreed, setAgreed] = useState(false)
  const needsWarning = isProductionKey(key) && !acknowledged
  return (
    <form
      className="form-stack key-form"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          setError('')
          try {
            const result = await connectApiKeyAction({ apiKey: key, acknowledged: agreed })
            if (!result.ok) setError(result.error)
            else onConnected()
          } catch {
            setError('Could not connect. Please try again.')
          }
        })
      }}
    >
      <ul className="key-form-modes">
        <li>
          <strong>Sandbox key</strong> (<code>jbe_test_…</code>): fictional jobs and sandbox forms,
          free. No employer is contacted.
        </li>
        <li>
          <strong>Production key</strong> (<code>jbe_live_…</code>): real jobs, and applications to
          real employers in your Jobo account.
        </li>
      </ul>
      <a className="text-link" href={API_KEYS_URL} target="_blank" rel="noopener noreferrer">
        Create a sandbox key in Jobo → API Keys <ArrowUpRight size={14} />
      </a>
      <label>
        Jobo API key
        <input
          name="apiKey"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="jbe_test_…"
          required
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      {needsWarning && (
        <div className="notice warning key-form-warning">
          <TriangleAlert size={18} />
          <div>
            <strong>That is a production key: these are real applications.</strong> Clicking Apply
            submits your profile to a real employer under your Jobo account. Job searches use your
            key’s credits.
            <label className="key-form-check">
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
      <small>
        Stored encrypted so applications can finish in the background. Replacing it switches
        environments.
      </small>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="key-form-actions">
        <button className="button primary" disabled={pending || (needsWarning && !agreed)}>
          {pending ? 'Checking key…' : submitLabel}
        </button>
        {children}
      </div>
    </form>
  )
}

/** The onboarding's first step; `/` then routes on to the resume step or the jobs. */
export function OnboardingKeyForm({ acknowledged }: { acknowledged: boolean }) {
  return (
    <ApiKeyForm
      acknowledged={acknowledged}
      submitLabel="Connect key"
      // A full load: `/` decides where to go next (app/page.tsx).
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      onConnected={() => window.location.assign('/')}
    />
  )
}
