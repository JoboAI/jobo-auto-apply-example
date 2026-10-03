'use client'
import { useEffect } from 'react'

/**
 * Shown when a page in the signed-in area throws. The full error is in the
 * server log; `digest` lets you match this screen to that log line.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => console.error(error), [error])
  return (
    <div className="empty-state">
      <h1>Let’s try that again.</h1>
      <p>We couldn’t load this page. Your saved work is still there.</p>
      {error.digest && <small>Reference: {error.digest}</small>}
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </div>
  )
}
