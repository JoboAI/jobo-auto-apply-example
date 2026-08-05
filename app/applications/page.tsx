import Link from 'next/link'
import { desc } from 'drizzle-orm'
import { db } from '@/db/client'
import { applications } from '@/db/schema'
import { Badge, ButtonLink, Empty, Panel, StatusBadge, relativeTime } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default function ApplicationsPage() {
  const rows = db.select().from(applications).orderBy(desc(applications.createdAt)).all()

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b hairline pb-6">
        <div>
          <p className="eyebrow">Reference</p>
          <h1 className="mt-1 font-display text-3xl font-medium text-ink-900">Applications</h1>
        </div>
        <ButtonLink href="/">New application</ButtonLink>
      </header>

      {rows.length === 0 ? (
        <Empty title="Applications not created yet.">
          <p>
            <Link href="/" className="font-medium text-brand hover:text-brand-deep hover:underline">
              Start one
            </Link>{' '}
            against a sandbox scenario to watch the whole loop without touching a real employer.
          </p>
        </Empty>
      ) : (
        /* Deliberately NOT polled. The list reads from the local database,
           which webhooks keep current; polling every open application from
           here would burn rate limit for no benefit. Open one to see it live. */
        <Panel padding="none">
          <div className="overflow-x-auto">
            <table className="s-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>URL</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((application) => (
                  <tr key={application.id}>
                    <td>
                      <Link
                        href={`/applications/${application.id}`}
                        className="font-medium text-ink-900 hover:underline"
                      >
                        {application.providerName || 'Unmatched provider'}
                      </Link>
                      {application.sandbox && (
                        <span className="ml-2">
                          <Badge>sandbox</Badge>
                        </span>
                      )}
                    </td>
                    <td className="max-w-72 truncate text-ink-600">{application.applyUrl}</td>
                    <td>
                      <StatusBadge status={application.status} />
                    </td>
                    <td className="text-ink-600">{relativeTime(application.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  )
}
