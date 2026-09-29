'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, Check, LoaderCircle, Sparkles } from 'lucide-react'
import { startApplicationAction } from '@/app/actions/applications'
import type { CardApplication } from '@/lib/presentation'

export function CardApply({
  jobId,
  profileId,
  available,
  application,
}: {
  jobId: string
  profileId?: string
  available: boolean
  application?: CardApplication
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [queuedId, setQueuedId] = useState<string>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (queuedId && queuedId === application?.id) setQueuedId(undefined)
  }, [queuedId, application?.id])
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
        }
      : application
  const active = current?.active ?? false
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(timer)
  }, [active, router])
  const submitted = current?.status === 'submitted'
  const queued = current?.status === 'queued'
  const retry = current?.retryable ?? false
  const visualState =
    pending || active
      ? 'pending'
      : submitted
        ? 'submitted'
        : !available && (!current || retry)
          ? 'unavailable'
          : retry
            ? 'retry'
            : current || !profileId
              ? 'secondary'
              : 'ready'
  const label = pending
    ? 'Queueing application…'
    : current?.cancelRequested && active
      ? 'Canceling…'
      : active
        ? queued
          ? 'Queued'
          : current?.status === 'creating'
            ? 'Opening application…'
            : 'Applying…'
        : submitted
          ? 'Submitted'
          : retry
            ? 'Retry with Auto Apply'
            : current
              ? 'View application'
              : !available
                ? 'Unavailable'
                : !profileId
                  ? 'Set up a profile'
                  : 'Apply with Auto Apply'

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
          setPending(true)
          setError('')
          try {
            const result = await startApplicationAction({
              jobId,
              profileId,
              retry,
            })
            if (!result.ok) {
              setError(result.error)
              return
            }
            setQueuedId(result.id)
            router.refresh()
          } catch {
            setError('Could not connect. Please try again.')
          } finally {
            setPending(false)
          }
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
            <span
              className={
                submitted ? 'done' : active && !queued ? 'running' : ''
              }
            />
            <span className={submitted ? 'done' : ''} />
          </div>
          <p role="status" aria-live="polite">
            {submitted
              ? 'Submission confirmed by the API.'
              : current.cancelRequested && active
                ? 'Waiting for cancellation confirmation.'
                : current.status === 'recovery_required'
                  ? 'Checking the API result before continuing.'
                  : active && queued
                    ? 'Saved to the queue. The worker will start automatically.'
                    : current.status === 'creating'
                      ? 'The API is discovering the application fields.'
                      : active
                        ? `${current.answeredSteps} ${current.answeredSteps === 1 ? 'step' : 'steps'} answered · Running in the background.`
                        : current.message || current.label}
          </p>
          <Link href={`/applications/${current.id}`} className="text-link">
            View application progress <ArrowUpRight size={13} />
          </Link>
        </div>
      ) : (
        <p className="card-apply-hint">Sandbox only · Runs in the background</p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
