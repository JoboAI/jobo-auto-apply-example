'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, Bookmark, Sparkles } from 'lucide-react'
import { saveJobAction } from '@/app/actions/jobs'
import { startApplicationAction } from '@/app/actions/applications'
export function SaveButton({
  jobId,
  saved,
}: {
  jobId: string
  saved: boolean
}) {
  const [pending, start] = useTransition(),
    [error, setError] = useState('')
  return (
    <span className="save-control">
      <button
        className={`icon-button ${saved ? 'saved' : ''}`}
        aria-label={saved ? 'Unsave job' : 'Save job'}
        aria-pressed={saved}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await saveJobAction(jobId, !saved)
            setError(result.ok ? '' : (result.error ?? 'Please try again.'))
          })
        }
      >
        <Bookmark size={19} fill={saved ? 'currentColor' : 'none'} />
      </button>
      {error && <small role="alert">{error}</small>}
    </span>
  )
}
export function ApplyButton({
  jobId,
  profileId,
  available,
  existingId,
  retry = false,
}: {
  jobId: string
  profileId?: string
  available: boolean
  existingId?: string
  retry?: boolean
}) {
  const router = useRouter(),
    [pending, start] = useTransition(),
    [error, setError] = useState('')
  return (
    <div>
      <button
        className="button primary"
        disabled={pending || (!available && !existingId)}
        onClick={() => {
          if (existingId) {
            router.push(`/applications/${existingId}`)
            return
          }
          if (!profileId) {
            router.push('/profiles')
            return
          }
          start(async () => {
            setError('')
            try {
              const result = await startApplicationAction({
                jobId,
                profileId,
                retry,
              })
              if (result.ok) router.push(`/applications/${result.id}`)
              else setError(result.error)
            } catch {
              setError('Could not connect. Please try again.')
            }
          })
        }}
      >
        <Sparkles size={16} />
        {pending
          ? 'Adding to your applications…'
          : existingId
            ? 'View application'
            : !available
              ? 'Currently unavailable'
              : !profileId
                ? 'Complete your profile'
                : retry
                  ? 'Try application again'
                  : 'Apply with Auto Apply'}
        <ArrowUpRight size={16} />
      </button>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
