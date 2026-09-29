'use client'
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty-state">
      <h1>Let’s try that again.</h1>
      <p>We couldn’t load this page. Your saved work is still there.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </div>
  )
}
