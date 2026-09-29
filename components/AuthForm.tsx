'use client'
import Link from 'next/link'
import { useState } from 'react'
import { ArrowRight, Mail, CheckCircle2 } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { SourceLink } from '@/components/SourceLink'
export function AuthForm({
  mode,
  token,
}: {
  mode: 'login' | 'signup' | 'forgot' | 'reset'
  token?: string
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [sent, setSent] = useState(false),
    [email, setEmail] = useState('')
  const title = {
    login: 'Welcome back.',
    signup: 'Create your demo account.',
    forgot: 'Let’s get you back in.',
    reset: 'A fresh start.',
  }[mode]
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    const data = new FormData(event.currentTarget)
    const password = String(data.get('password') ?? '')
    try {
      const result =
        mode === 'signup'
          ? await authClient.signUp.email({
              name: String(data.get('name')),
              email,
              password,
              callbackURL: '/jobs',
            })
          : mode === 'login'
            ? await authClient.signIn.email({
                email,
                password,
                callbackURL: '/jobs',
              })
            : mode === 'forgot'
              ? await authClient.requestPasswordReset({
                  email,
                  redirectTo: '/reset-password',
                })
              : await authClient.resetPassword({
                  newPassword: password,
                  token: token ?? '',
                })
      if (result.error) {
        setError(
          result.error.message ?? 'Something went wrong. Please try again.',
        )
        return
      }
      if (mode === 'login') window.location.assign('/jobs')
      else setSent(true)
    } catch {
      setError('Unable to connect. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="auth-page">
      <Link href="/" className="logo">
        <img src="/logos/jobo-logo.svg" alt="Jobo" />
      </Link>
      <section className="auth-card">
        {sent ? (
          <div className="auth-success">
            <CheckCircle2 size={40} />
            <h1>
              {mode === 'reset' ? 'Password updated.' : 'Check your inbox.'}
            </h1>
            <p>
              {mode === 'signup'
                ? `We sent a verification link to ${email}. Open it to finish creating your account.`
                : mode === 'forgot'
                  ? 'If an account exists for that email, a reset link is on its way.'
                  : 'You can now log in with your new password.'}
            </p>
            <Link href="/login" className="button primary">
              Back to login <ArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <>
            <span className="eyebrow">AUTO APPLY API · DEVELOPER DEMO</span>
            <h1>{title}</h1>
            <p>
              {mode === 'signup'
                ? 'Test the Auto Apply API with a private profile and sandbox jobs.'
                : mode === 'login'
                  ? 'Continue testing applications in your private sandbox workspace.'
                  : 'We’ll help you access your Jobo account.'}
            </p>
            <form onSubmit={submit} className="form-stack">
              {mode === 'signup' && (
                <label>
                  Full name
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={100}
                    placeholder="Alex Morgan"
                  />
                </label>
              )}
              {mode !== 'reset' && (
                <label>
                  Email address
                  <input
                    type="email"
                    autoComplete="email"
                    name="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </label>
              )}
              {mode !== 'forgot' && (
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    autoComplete={
                      mode === 'login' ? 'current-password' : 'new-password'
                    }
                    minLength={mode === 'login' ? 1 : 12}
                    required
                    placeholder={
                      mode === 'login'
                        ? 'Your password'
                        : 'At least 12 characters'
                    }
                  />
                </label>
              )}
              {mode === 'login' && (
                <Link className="text-link align-right" href="/forgot-password">
                  Forgot password?
                </Link>
              )}
              {mode === 'reset' && !token && (
                <div className="notice warning">
                  This reset link is missing or invalid.{' '}
                  <Link href="/forgot-password">Request a new link</Link>.
                </div>
              )}
              {error && (
                <div role="alert" className="notice danger">
                  {error}
                </div>
              )}
              <button
                disabled={busy || (mode === 'reset' && !token)}
                className="button primary full-width"
              >
                {busy
                  ? 'One moment…'
                  : mode === 'login'
                    ? 'Log in'
                    : mode === 'signup'
                      ? 'Create your account'
                      : mode === 'forgot'
                        ? 'Send reset link'
                        : 'Update password'}
                <ArrowRight size={17} />
              </button>
            </form>
            {mode === 'login' && (
              <button
                className="text-link resend"
                disabled={busy || !email}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const r = await authClient.sendVerificationEmail({
                      email,
                      callbackURL: '/jobs',
                    })
                    if (r.error)
                      setError(r.error.message ?? 'Could not send email.')
                    else
                      setError(
                        'If verification is needed, a new link is on its way.',
                      )
                  } catch {
                    setError('Could not send email.')
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <Mail size={14} /> Resend verification email
              </button>
            )}
            <div className="auth-switch">
              {mode === 'signup' ? (
                <>
                  Already have an account? <Link href="/login">Log in</Link>
                </>
              ) : (
                <>
                  New here? <Link href="/signup">Create an account</Link>
                </>
              )}
            </div>
          </>
        )}
      </section>
      <div className="auth-caption">
        <p>Jobo Auto Apply Demo · Fictional jobs. No real employers contacted.</p>
        <SourceLink />
      </div>
    </div>
  )
}
