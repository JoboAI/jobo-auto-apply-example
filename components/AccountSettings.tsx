'use client'
import { useState } from 'react'
import { authClient } from '@/lib/auth-client'
export function AccountSettings({ name, email }: { name: string; email: string }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  return (
    <div className="settings-stack">
      <section className="surface settings-card">
        <h2>Your account</h2>
        <p className="subtle">{email}</p>
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault()
            const form = e.currentTarget
            setBusy(true)
            try {
              const r = await authClient.updateUser({
                name: String(new FormData(form).get('name')),
              })
              setMessage(r.error?.message ?? 'Your name is updated.')
            } catch {
              setMessage('Could not save. Please try again.')
            } finally {
              setBusy(false)
            }
          }}
        >
          <label>
            Full name
            <input name="name" defaultValue={name} required maxLength={100} />
          </label>
          <button disabled={busy} className="button primary">
            Save name
          </button>
        </form>
      </section>
      <section className="surface settings-card">
        <h2>Change password</h2>
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault()
            const form = e.currentTarget,
              data = new FormData(form)
            setBusy(true)
            try {
              const r = await authClient.changePassword({
                currentPassword: String(data.get('current')),
                newPassword: String(data.get('next')),
                revokeOtherSessions: true,
              })
              setMessage(
                r.error?.message ??
                  'Your password is updated. Other sessions have been signed out.',
              )
              if (!r.error) form.reset()
            } catch {
              setMessage('Could not update password.')
            } finally {
              setBusy(false)
            }
          }}
        >
          <label>
            Current password
            <input name="current" type="password" autoComplete="current-password" required />
          </label>
          <label>
            New password
            <input
              name="next"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              placeholder="At least 12 characters"
            />
          </label>
          <button disabled={busy} className="button secondary">
            Update password
          </button>
        </form>
      </section>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <button
        className="button secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            const r = await authClient.signOut()
            if (r.error) {
              setMessage(r.error.message ?? 'Could not sign out.')
              return
            }
            // A full load: every server-rendered page has to forget the session.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.assign('/')
          } catch {
            setMessage('Could not sign out. Please try again.')
          } finally {
            setBusy(false)
          }
        }}
      >
        Log out
      </button>
    </div>
  )
}
