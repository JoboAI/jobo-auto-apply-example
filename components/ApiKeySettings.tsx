'use client'
import { useState } from 'react'
import { forgetApiKeyAction } from '@/app/actions/api-key'
import type { KeySettings } from '@/lib/user-settings'
import { useBusy } from '@/lib/use-busy'
import { ApiKeyForm } from './ApiKeyForm'

/**
 * The settings-page panel for the visitor's Jobo API key. Replacing the key
 * is how a visitor switches between sandbox and production.
 */
export function ApiKeySettings({ mode, keyHint, acknowledged }: KeySettings) {
  const [pending, start] = useBusy()
  const [error, setError] = useState('')
  // A full load after a change: the top bar, feed and job pages all follow the key.
  const reload = (path: string) => window.location.assign(path)
  return (
    <section className="surface settings-card" id="api-key">
      <h2>Jobo API key</h2>
      <p className="subtle">
        {mode === 'production'
          ? `A production key ending ${keyHint} is connected: you are applying to real employers.`
          : mode === 'sandbox'
            ? `A sandbox key ending ${keyHint} is connected: fictional jobs and sandbox forms.`
            : 'No key is connected yet.'}{' '}
        Paste another key to replace it.
      </p>
      <ApiKeyForm
        acknowledged={acknowledged}
        submitLabel={mode ? 'Replace key' : 'Connect key'}
        onConnected={() => reload('/jobs')}
      >
        {mode && (
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError('')
                try {
                  await forgetApiKeyAction()
                } catch {
                  setError('Could not remove the key. Please try again.')
                  return
                }
                reload('/onboarding')
              })
            }
          >
            Remove key
          </button>
        )}
      </ApiKeyForm>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
