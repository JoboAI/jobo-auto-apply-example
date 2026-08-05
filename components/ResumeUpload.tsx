'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { btn } from './ui'

/**
 * Uploads to the route handler at /api/profiles/import rather than calling a
 * Server Action — Server Actions cap bodies at 1 MB by default and plenty of
 * resumes are larger. See the comment in that route.
 */
export function ResumeUpload({
  /** Override the post-upload destination (the tutorial stays on its step). */
  redirectTo
}: {
  redirectTo?: string
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File) {
    setBusy(true)
    setError(null)

    const body = new FormData()
    body.append('resume', file)

    try {
      const response = await fetch('/api/profiles/import', { method: 'POST', body })

      // Not every response comes from this app. A proxy or CDN in front of it
      // answers timeouts and upstream failures with its own HTML page or an
      // empty body, and calling .json() on those throws "Unexpected token '<'"
      // or "Unexpected end of JSON input" — which tells the user nothing about
      // what went wrong. Read the body once, then decide.
      const raw = await response.text()
      let payload: { redirectTo?: string; error?: string } = {}
      try {
        payload = raw ? (JSON.parse(raw) as typeof payload) : {}
      } catch {
        setError(
          `The server returned an unexpected ${response.status} response. ` +
            'Check the app logs — this usually means it failed upstream of the route.'
        )
        return
      }

      if (!response.ok) {
        setError(payload.error ?? `Upload failed (${response.status})`)
        return
      }
      const destination = redirectTo ?? payload.redirectTo
      if (destination) {
        router.push(destination)
        router.refresh()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const file = event.dataTransfer.files?.[0]
          if (file) void upload(file)
        }}
        className="border border-dashed hairline bg-white px-6 py-10 text-center"
      >
        <p className="text-sm font-medium text-ink-800">
          {busy ? 'Parsing resume…' : 'Drop a PDF resume here'}
        </p>
        <p className="mt-1 text-xs text-ink-600">
          {busy
            ? 'Extracting text, then structuring it with OpenRouter.'
            : 'Text-based PDFs only — a scan has no text to extract. Max 5 MB.'}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className={`${btn('secondary', 'sm')} mt-4`}
        >
          Choose a file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void upload(file)
          }}
        />
      </div>
      {error && <p className="mt-3 bg-danger-tint px-3 py-2 text-sm text-danger-deep">{error}</p>}
    </div>
  )
}
