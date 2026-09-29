import Link from 'next/link'
import { desc, eq } from 'drizzle-orm'
import { ArrowUpRight, ArrowRight, Layers, Send, Clock3 } from 'lucide-react'
import { db } from '@/db/client'
import { applications } from '@/db/schema'
import { requireUser } from '@/lib/session'
import { applicationLabel, displayDate } from '@/lib/presentation'
import { isTerminal } from '@/lib/status'
import { LiveRefresh } from '@/components/ApplicationLive'
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const user = await requireUser(),
    { status } = await searchParams
  const rows = db
    .select()
    .from(applications)
    .where(eq(applications.userId, user.id))
    .orderBy(desc(applications.createdAt))
    .all()
  const active = rows.filter((r) => !isTerminal(r.status)),
    submitted = rows.filter((r) => r.status === 'submitted')
  const filtered = rows.filter(
    (r) =>
      !status ||
      status === 'all' ||
      (status === 'active' && !isTerminal(r.status)) ||
      (status === 'submitted' && r.status === 'submitted') ||
      (status === 'incomplete' &&
        ['Couldn’t complete', 'Canceled'].includes(applicationLabel(r))),
  )
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">AUTO APPLY API · APPLICATION RUNS</div>
          <h1>Track your API demo runs.</h1>
          <p>Follow queued jobs, running applications, and confirmed API results.</p>
        </div>
        <LiveRefresh active={!!active.length} />
      </div>
      <div className="stats-grid">
        {[
          { label: 'Applications started', value: rows.length, icon: Layers },
          { label: 'In progress', value: active.length, icon: Clock3 },
          {
            label: 'Successfully submitted',
            value: submitted.length,
            icon: Send,
          },
        ].map(({ label, value, icon: Icon }) => (
          <div className="surface stat-card" key={label}>
            <span>
              <Icon size={20} />
              {label}
            </span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="section-heading">
        <nav className="tabs" aria-label="Filter applications">
          {[
            ['all', 'All applications'],
            ['active', 'In progress'],
            ['submitted', 'Submitted'],
            ['incomplete', 'Not completed'],
          ].map(([key, label]) => (
            <Link
              key={key}
              href={`/applications?status=${key}`}
              className={(status ?? 'all') === key ? 'selected' : ''}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="surface application-list">
        {filtered.map((row) => (
          <Link
            className="application-row"
            key={row.id}
            href={`/applications/${row.id}`}
          >
            <span className="company-mark purple">
              {row.jobSnapshot?.mark ?? 'JB'}
            </span>
            <div className="application-role">
              <strong>{row.jobSnapshot?.role ?? 'Sandbox application'}</strong>
              <span>
                {row.jobSnapshot?.company} · {row.jobSnapshot?.location}
              </span>
            </div>
            <span className={`status-badge status-${row.status}`}>
              {applicationLabel(row)}
            </span>
            <time>{displayDate(row.createdAt)}</time>
            <ArrowUpRight size={18} />
          </Link>
        ))}
        {!filtered.length && (
          <div className="empty-state">
            <Send size={29} />
            <h2>
              {rows.length
                ? 'Nothing in this view yet.'
                : 'Start your first sandbox application.'}
            </h2>
            <p>Click Apply on a sandbox job to test the integration end to end.</p>
            <Link className="button primary" href="/jobs">
              Discover jobs <ArrowRight size={16} />
            </Link>
          </div>
        )}
      </div>
    </>
  )
}
