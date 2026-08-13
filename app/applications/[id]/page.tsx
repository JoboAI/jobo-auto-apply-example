import { notFound } from 'next/navigation'
import Link from 'next/link'
import { isTerminal } from '@/lib/status'
import { Badge, StatusBadge, relativeTime } from '@/components/ui'
import { ApplicationInspector, loadApplicationView } from '@/components/ApplicationInspector'
import { StatusTimeline } from '@/components/StatusTimeline'
import { AutoRunner } from '@/components/AutoRunner'
import { ApplicationActions } from '@/components/ApplicationActions'

export const dynamic = 'force-dynamic'
// The AutoRunner's advance action can hold a blocking exchange with Jobo for
// minutes at a time — do not let a platform default cut it off first.
export const maxDuration = 600

/**
 * Reference view of one application. The tutorial's third cell renders the
 * same inspector with a teaching rail around it — this page is the plain
 * version for everyday use.
 */
export default async function ApplicationDetailPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const view = await loadApplicationView(id)
  if (!view) notFound()

  const { application } = view
  const open = !isTerminal(application.status) && application.status !== 'create_failed'

  return (
    <div className="space-y-6">
      {/* The portal's service-header pattern: eyebrow, display title, status,
          actions right, meta row, hairline. */}
      <header className="border-b hairline pb-6">
        <p className="eyebrow">Application</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-medium text-ink-900">
              {application.providerName || 'Application'}
            </h1>
            <StatusBadge status={application.status} />
            {application.sandbox && <Badge>sandbox</Badge>}
          </div>
          {application.joboApplicationId && (
            <ApplicationActions id={application.id} cancelable={open} />
          )}
        </div>
        <p className="mt-2 break-all text-sm text-ink-600">{application.applyUrl}</p>
        {application.joboApplicationId && (
          <p className="mt-1 font-mono text-xs text-ink-500">{application.joboApplicationId}</p>
        )}
      </header>

      {/* Drives the loop from the browser: one blocking advance at a time,
          refreshing this page between turns, stopping at a terminal status. */}
      <AutoRunner id={application.id} active={open} />

      <StatusTimeline application={application} steps={view.steps} />

      <ApplicationInspector view={view} />

      <p className="text-xs text-ink-500">
        Created {relativeTime(application.createdAt)} · last synced{' '}
        {relativeTime(application.lastSyncedAt)} ·{' '}
        <Link href="/applications" className="underline">
          all applications
        </Link>{' '}
        · the concepts on this page are covered in{' '}
        <Link href="/learn" className="underline">
          the tutorial
        </Link>
      </p>
    </div>
  )
}
