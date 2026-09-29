'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UploadCloud, FileText, ArrowUpRight } from 'lucide-react'
export function ResumeUpload() {
  const router = useRouter(),
    input = useRef<HTMLInputElement>(null),
    busyRef = useRef(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function upload(file: File) {
    if (busyRef.current) return
    if (file.size > 5 * 1024 * 1024) {
      setError('Please choose a PDF smaller than 5 MB.')
      return
    }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please choose a text-based PDF resume.')
      return
    }
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const body = new FormData()
      body.append('resume', file)
      const response = await fetch('/api/profiles/import', {
        method: 'POST',
        body,
      })
      const payload = await response
        .json()
        .catch(() => ({
          error: 'The upload couldn’t finish. Please try again.',
        }))
      if (!response.ok) {
        setError(payload.error ?? 'Could not upload your resume.')
        return
      }
      router.push(payload.redirectTo)
      router.refresh()
    } catch {
      setError(
        'Could not upload your resume. Check your connection and try again.',
      )
    } finally {
      busyRef.current = false
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <div
      className="upload-zone"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const file = e.dataTransfer.files[0]
        if (file) void upload(file)
      }}
      aria-busy={busy}
    >
      <span className="upload-icon">
        {busy ? <span className="spinner" /> : <UploadCloud size={27} />}
      </span>
      <h3>
        {busy
          ? 'Getting to know your experience…'
          : 'Start with a candidate resume.'}
      </h3>
      <p>
        {busy
          ? 'Reading your resume and organizing your profile. This can take a minute.'
          : 'Drop your resume here, or choose a file to get started.'}
      </p>
      <button
        type="button"
        className="button primary"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? 'Reading resume…' : 'Upload your resume'}
        <ArrowUpRight size={16} />
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        aria-label="Upload PDF resume"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) void upload(e.target.files[0])
        }}
      />
      <small>
        <FileText size={13} /> Text-based PDF · Up to 5 MB
      </small>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="sr-only">
          Reading your resume. Please wait.
        </p>
      )}
    </div>
  )
}
