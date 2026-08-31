import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { profiles } from '@/db/schema'
import { Panel } from '@/components/ui'
import { NotesEditor } from '@/components/ProfileEditor'

export const dynamic = 'force-dynamic'

export default async function ProfileDetailPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const profile = db.select().from(profiles).where(eq(profiles.id, id)).get()
  if (!profile) notFound()

  const data = profile.data

  return (
    <div className="space-y-6">
      <header className="border-b hairline pb-6">
        <p className="eyebrow">Profile</p>
        <h1 className="mt-1 font-display text-3xl font-medium text-ink-900">{profile.name}</h1>
        <p className="mt-2 text-sm text-ink-600">
          {profile.resumeFilename} · {(profile.resumeBytes / 1024).toFixed(0)} KB · parsed from{' '}
          {profile.resumeText.length.toLocaleString()} characters of text
        </p>
      </header>

      <Panel title="Freeform context">
        <NotesEditor profileId={profile.id} initial={data.about.freeform_notes} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Personal">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {[
              ['Name', data.personal.full_name],
              ['Email', data.personal.email],
              ['Phone', data.personal.phone],
              ['Headline', data.personal.headline],
              [
                'Location',
                [data.location.city, data.location.region, data.location.country_code]
                  .filter(Boolean)
                  .join(', ')
              ]
            ].map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="muted">{label}</dt>
                <dd className="truncate">{value || '—'}</dd>
              </div>
            ))}
          </dl>
          {data.links.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {data.links.map((link) => (
                <li key={link.url} className="truncate">
                  <span className="muted mr-2 text-xs">{link.type}</span>
                  <a href={link.url} className="hover:underline" rel="noreferrer noopener" target="_blank">
                    {link.url}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Work authorization & preferences">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {[
              ['Authorized in', data.work_authorization.authorized_country_codes.join(', ')],
              [
                'Needs sponsorship',
                data.work_authorization.requires_sponsorship === null
                  ? null
                  : data.work_authorization.requires_sponsorship
                    ? 'Yes'
                    : 'No'
              ],
              ['Notice period', data.work_authorization.notice_period_days ? `${data.work_authorization.notice_period_days} days` : null],
              ['Remote preference', data.preferences.remote_preference],
              [
                'Willing to relocate',
                data.preferences.willing_to_relocate === null
                  ? null
                  : data.preferences.willing_to_relocate
                    ? 'Yes'
                    : 'No'
              ],
              [
                'Desired salary',
                data.preferences.desired_salary
                  ? `${data.preferences.desired_salary.toLocaleString()} ${data.preferences.salary_currency ?? ''}`.trim()
                  : null
              ]
            ].map(([label, value]) => (
              <div key={label as string} className="contents">
                <dt className="muted">{label}</dt>
                <dd>{value || '—'}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>

      <Panel title="Work experience">
        {data.work_experience.length === 0 ? (
          <p className="muted text-sm">None parsed.</p>
        ) : (
          <ul className="divide-y hairline">
            {data.work_experience.map((role, index) => (
              <li key={`${role.company}-${index}`} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    {role.title} · <span className="muted font-normal">{role.company}</span>
                  </p>
                  <p className="muted text-xs">
                    {role.start_date} — {role.is_current ? 'present' : (role.end_date ?? '?')}
                  </p>
                </div>
                {role.description && <p className="muted mt-1 text-sm">{role.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Education">
        {data.education.length === 0 ? (
          <p className="muted text-sm">None parsed.</p>
        ) : (
          <ul className="divide-y hairline">
            {data.education.map((entry, index) => (
              <li key={`${entry.school}-${index}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <p className="text-sm">
                  <span className="font-medium">{entry.school}</span>
                  {entry.degree && <span className="muted"> · {entry.degree}</span>}
                  {entry.field_of_study && <span className="muted"> · {entry.field_of_study}</span>}
                </p>
                <p className="muted text-xs">
                  {entry.start_date ?? '?'} — {entry.is_current ? 'present' : (entry.end_date ?? '?')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Skills & languages">
          <div className="flex flex-wrap gap-1.5">
            {data.skills.map((skill) => (
              <span key={skill.name} className="bg-ink-100 px-2 py-0.5 text-xs text-ink-800">
                {skill.name}
              </span>
            ))}
          </div>
          {data.languages.length > 0 && (
            <ul className="mt-3 text-sm">
              {data.languages.map((language) => (
                <li key={language.name}>
                  {language.name}
                  {language.proficiency && <span className="muted"> — {language.proficiency}</span>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}
