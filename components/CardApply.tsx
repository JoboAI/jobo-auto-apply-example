'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, Check, LoaderCircle, Sparkles } from 'lucide-react'
import { startApplicationAction } from '@/app/actions/applications'
import type { LiveState } from '@/lib/live-version'
import type { CardApplication } from '@/lib/presentation'
import { useBusy } from '@/lib/use-busy'
import { AccessProblemNotice } from './AccessProblemNotice'
import { AiConsentDialog } from './AiConsentDialog'

const POLL_MS = 3000
/** Polls in a row showing a status the card has not rendered before a reload. */
const STUCK_POLLS = 3

/**
 * The Apply button on a job card, and the progress of that job's latest
 * application. It queues through a server action, then polls the small
 * /api/applications/[id]/live endpoint while the worker runs, re-rendering
 * only when something changed.
 */
export function CardApply({
  jobId,
  profileId,
  available,
  application,
  production = false,
}: {
  jobId: string
  profileId?: string
  available: boolean
  application?: CardApplication
  production?: boolean
}) {
  const router = useRouter()
  const [pending, start] = useBusy()
  const [queuedId, setQueuedId] = useState<string>()
  const [error, setError] = useState('')
  const [consentOpen, setConsentOpen] = useState(false)
  const apply = (profile: string, aiConsent?: true) =>
    start(async () => {
      setError('')
      try {
        const result = await startApplicationAction({ jobId, profileId: profile, retry, aiConsent })
        if (!result.ok) {
          if (result.aiConsentRequired) setConsentOpen(true)
          else setError(result.error)
          return
        }
        setQueuedId(result.id)
        router.refresh()
      } catch {
        setError('Could not connect. Please try again.')
      }
    })
  // The persisted row has arrived: drop the placeholder below.
  if (queuedId && queuedId === application?.id) setQueuedId(undefined)
  // Keep immediate feedback until the persisted row arrives on refresh.
  const current: CardApplication | undefined =
    queuedId && application?.id !== queuedId
      ? {
          id: queuedId,
          status: 'queued',
          label: 'Queued',
          active: true,
          retryable: false,
          cancelRequested: false,
          answeredSteps: 0,
          message: null,
          access: null,
        }
      : application
  const active = current?.active ?? false
  // The status on screen, recorded after commit: a refresh can render the new
  // state and never commit it (see lib/use-busy.ts).
  const renderedStatus = useRef(current?.status)
  useEffect(() => {
    renderedStatus.current = current?.status
  }, [current?.status])
  const watchedId = current?.id
  useEffect(() => {
    if (!active || !watchedId) return
    let stuck = 0
    let busy = false
    let lastVersion: string | undefined
    const timer = setInterval(async () => {
      if (busy || document.visibilityState === 'hidden') return
      busy = true
      try {
        const response = await fetch(`/api/applications/${watchedId}/live`, { cache: 'no-store' })
        if (!response.ok) return
        const live = (await response.json()) as LiveState
        // Re-render only when the worker changed something.
        if (live.version !== lastVersion) {
          lastVersion = live.version
          router.refresh()
        }
        // A status the card has not shown for several polls in a row means
        // the refreshes are not landing; a full load recovers.
        if (live.status === renderedStatus.current) stuck = 0
        else if (++stuck >= STUCK_POLLS) window.location.reload()
      } catch {
        // Offline or restarting; the next poll tries again.
      } finally {
        busy = false
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [active, watchedId, router])
  const submitted = current?.status === 'submitted'
  const queued = current?.status === 'queued'
  const retry = current?.retryable ?? false
  const { state: visualState, label } = buttonPresentation({
    pending,
    active,
    current,
    retry,
    available,
    profileId,
  })
  return (
    <div className={`card-apply ${submitted ? 'card-apply-submitted' : ''}`}>
      <button
        className="button card-apply-button"
        data-state={visualState}
        disabled={pending || active || (!available && (!current || retry))}
        onClick={async () => {
          if (current && !retry) {
            router.push(`/applications/${current.id}`)
            return
          }
          if (!profileId) {
            router.push('/profiles')
            return
          }
          await apply(profileId)
        }}
      >
        {pending || active ? (
          <LoaderCircle size={17} className="apply-spinner" />
        ) : submitted ? (
          <Check size={17} />
        ) : (
          <Sparkles size={17} />
        )}
        {label}
        {!pending && !active && <ArrowUpRight size={16} />}
      </button>
      {current ? (
        <div className="card-apply-progress">
          <div className="apply-stages" aria-hidden="true">
            <span className="done" />
            <span className={submitted ? 'done' : active && !queued ? 'running' : ''} />
            <span className={submitted ? 'done' : ''} />
          </div>
          {current.access ? (
            <AccessProblemNotice problem={current.access} />
          ) : (
            <p role="status" aria-live="polite">
              {progressMessage(current, active)}
            </p>
          )}
          <Link href={`/applications/${current.id}`} className="text-link">
            View application progress <ArrowUpRight size={13} />
          </Link>
        </div>
      ) : (
        <p className="card-apply-hint">
          {production
            ? 'Real employer · Your production key · Runs in the background'
            : 'Sandbox form · Your sandbox key · Runs in the background'}
        </p>
      )}
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
            void apply(profileId, true)
          }}
        />
      )}
    </div>
  )
}

/**
 * What the Apply button shows: its look (`data-state`, styled in globals.css)
 * and its label. Checked top to bottom; the first match wins.
 */
function buttonPresentation({
  pending,
  active,
  current,
  retry,
  available,
  profileId,
}: {
  pending: boolean
  active: boolean
  current?: CardApplication
  retry: boolean
  available: boolean
  profileId?: string
}): { state: string; label: string } {
  if (pending) return { state: 'pending', label: 'Queueing application…' }
  if (active) {
    if (current?.cancelRequested) return { state: 'pending', label: 'Canceling…' }
    if (current?.status === 'queued') return { state: 'pending', label: 'Queued' }
    if (current?.status === 'creating') return { state: 'pending', label: 'Opening application…' }
    return { state: 'pending', label: 'Applying…' }
  }
  if (current?.status === 'submitted') return { state: 'submitted', label: 'Submitted' }
  if (retry) return { state: available ? 'retry' : 'unavailable', label: 'Retry with Auto Apply' }
  if (current) return { state: 'secondary', label: 'View application' }
  if (!available) return { state: 'unavailable', label: 'Unavailable' }
  if (!profileId) return { state: 'secondary', label: 'Set up a profile' }
  return { state: 'ready', label: 'Apply with Auto Apply' }
}

/** The line under the button describing where the application is. */
function progressMessage(current: CardApplication, active: boolean): string {
  if (current.status === 'submitted') return 'Submission confirmed by the API.'
  if (current.cancelRequested && active) return 'Waiting for cancellation confirmation.'
  if (current.status === 'recovery_required') return 'Checking the API result before continuing.'
  if (active && current.status === 'queued')
    return 'Saved to the queue. The worker will start automatically.'
  if (current.status === 'creating') return 'The API is discovering the application fields.'
  if (active)
    return `${current.answeredSteps} ${current.answeredSteps === 1 ? 'step' : 'steps'} answered · Running in the background.`
  return current.message || current.label
}
