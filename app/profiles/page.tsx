import Link from 'next/link'
import { desc } from 'drizzle-orm'
import { db } from '@/db/client'
import { profiles } from '@/db/schema'
import { Badge, Panel, relativeTime } from '@/components/ui'
import { ResumeUpload } from '@/components/ResumeUpload'

export const dynamic = 'force-dynamic'

export default function ProfilesPage() {
  const rows = db.select().from(profiles).orderBy(desc(profiles.createdAt)).all()

  return (
    <div className="space-y-6">
      <header className="border-b hairline pb-6">
        <p className="eyebrow">Reference</p>
        <h1 className="mt-1 font-display text-3xl font-medium text-ink-900">Profiles</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-600">
          Each profile is a resume parsed into structured fields. Jobo never sees any of this — it
          only ever receives the individual answers this app produces.
        </p>
      </header>

      <Panel title="Import a resume">
        <ResumeUpload />
      </Panel>

      {rows.length === 0 ? null : (
        <Panel title={`${rows.length} profile${rows.length === 1 ? '' : 's'}`}>
          <ul className="divide-y hairline">
            {rows.map((profile) => (
              <li key={profile.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/profiles/${profile.id}`}
                    className="font-medium text-ink-900 hover:underline"
                  >
                    {profile.name}
                  </Link>
                  <p className="truncate text-xs text-ink-600">
                    {profile.data.personal.email || 'no email'} ·{' '}
                    {profile.data.work_experience.length} roles ·{' '}
                    {profile.data.education.length} education ·{' '}
                    {relativeTime(profile.createdAt)}
                  </p>
                </div>
                {profile.isDefault && <Badge tone="info">default</Badge>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}
