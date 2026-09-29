import Link from 'next/link'
export default function NotFound() {
  return (
    <main className="empty-state">
      <h1>This page has moved on.</h1>
      <p>Return to the sandbox catalog to test Auto Apply.</p>
      <Link className="button primary" href="/jobs">
        Discover jobs
      </Link>
    </main>
  )
}
