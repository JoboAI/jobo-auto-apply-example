'use client'
import { useEffect } from 'react'
import './globals.css'

/**
 * Last-resort boundary for errors in the root layout itself. It replaces the
 * whole document, so it renders its own <html> and <body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => console.error(error), [error])
  return (
    <html lang="en">
      <body>
        <div className="empty-state">
          <h1>Something went wrong.</h1>
          <p>Please try again. If it keeps happening, check the server log.</p>
          {error.digest && <small>Reference: {error.digest}</small>}
          <button className="button primary" onClick={reset}>
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
