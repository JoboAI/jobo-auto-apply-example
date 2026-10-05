'use client'
import { useState } from 'react'
import { pushWithFallback, useBusy } from '@/lib/use-busy'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, Bookmark, Sparkles } from 'lucide-react'
import { saveJobAction } from '@/app/actions/jobs'
import { startApplicationAction } from '@/app/actions/applications'
import { AiConsentDialog } from './AiConsentDialog'
/**
 * Bookmark toggle. The new state shows as soon as the action succeeds, rather
 * than waiting for the server re-render to commit (see lib/use-busy.ts).
 */
export function SaveButton({ jobId, saved }: { jobId: string; saved: boolean }) {
  const [pending, start] = useBusy(),
    [isSaved, setSaved] = useState(saved),
    [serverSaved, setServerSaved] = useState(saved),
    [error, setError] = useState('')
  // A fresh server render (another tab, a reload) is the source of truth.
  if (saved !== serverSaved) {
    setServerSaved(saved)
    setSaved(saved)
  }
  return (
    <span className="save-control">
      <button
        className={`icon-button ${isSaved ? 'saved' : ''}`}
        aria-label={isSaved ? 'Unsave job' : 'Save job'}
        aria-pressed={isSaved}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await saveJobAction(jobId, !isSaved)
            if (result.ok) setSaved(!isSaved)
            setError(result.ok ? '' : (result.error ?? 'Please try again.'))
          })
        }
      >
        <Bookmark size={19} fill={isSaved ? 'currentColor' : 'none'} />
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
    [pending, start] = useBusy(),
    [error, setError] = useState(''),
    [consentOpen, setConsentOpen] = useState(false)
  const apply = (profile: string, aiConsent?: true) =>
    start(async () => {
      setError('')
      try {
        const result = await startApplicationAction({ jobId, profileId: profile, retry, aiConsent })
        if (result.ok) pushWithFallback(router, `/applications/${result.id}`)
        else if (result.aiConsentRequired) setConsentOpen(true)
        else setError(result.error)
      } catch {
        setError('Could not connect. Please try again.')
      }
    })
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
          apply(profileId)
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
      {profileId && (
        <AiConsentDialog
          open={consentOpen}
          onClose={() => setConsentOpen(false)}
          onAccept={() => {
            setConsentOpen(false)
            apply(profileId, true)
          }}
        />
      )}
    </div>
  )
}
