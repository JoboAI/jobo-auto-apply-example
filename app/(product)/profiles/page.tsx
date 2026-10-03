import type { Metadata } from 'next'
import { isApplicationReady } from '@/lib/resume/completeness'
import Link from 'next/link'
import { and, desc, eq } from 'drizzle-orm'
import { FileText, ArrowUpRight, CheckCircle2 } from 'lucide-react'
import { db } from '@/db/client'
import { profiles } from '@/db/schema'
import { requireUser } from '@/lib/session'
import { ResumeUpload } from '@/components/ResumeUpload'
import { ProfileControls } from '@/components/ProfileControls'

export const metadata: Metadata = { title: 'Profiles' }
export default async function ProfilesPage() {
  const user = await requireUser()
  const rows = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.userId, user.id), eq(profiles.archived, false)))
    .orderBy(desc(profiles.isDefault), desc(profiles.createdAt))
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CANDIDATE DATA FOR YOUR API DEMO</div>
          <h1>{rows.length ? 'Your test profiles.' : 'Add a test profile.'}</h1>
          <p>
            Manage the candidate data this demo uses to answer application fields. Each application
            keeps its own saved copy.
          </p>
        </div>
      </div>
      <div className="profile-layout">
        <section>
          <ResumeUpload />
          {rows.length > 0 && (
            <>
              <div className="section-heading resume-heading">
                <h2>
                  Your resumes <span className="count">{rows.length}</span>
                </h2>
              </div>
              {rows.map((row) => (
                <article className="surface resume-card" key={row.id}>
                  <span className="file-icon">
                    <FileText size={23} />
                  </span>
                  <div className="resume-info">
                    <Link href={`/profiles/${row.id}`}>
                      <h3>{row.name}</h3>
                    </Link>
                    <p>
                      {row.resumeFilename} · {Math.ceil(row.resumeBytes / 1024)} KB
                    </p>
                    <div className="tag-row">
                      {row.isDefault && <span className="tag purple-tag">Default resume</span>}
                      <span className="tag">
                        {isApplicationReady(row) ? 'Reviewed & ready' : 'Review needed'}
                      </span>
                    </div>
                    <ProfileControls id={row.id} isDefault={row.isDefault} />
                  </div>
                  <Link
                    aria-label={`Review ${row.name}`}
                    href={`/profiles/${row.id}`}
                    className="icon-button"
                  >
                    <ArrowUpRight size={20} />
                  </Link>
                </article>
              ))}
            </>
          )}
        </section>
        <aside className="aside-card profile-help">
          <span className="mini-icon">
            <CheckCircle2 size={23} />
          </span>
          <h2>The facts behind each answer.</h2>
          <p>
            This demo combines confirmed profile values with generated answers for open-ended
            application questions.
          </p>
          <ol>
            <li>Upload a text-based PDF.</li>
            <li>Check the details we’ve extracted.</li>
            <li>Add preferences and anything else we should know.</li>
            <li>Confirm your profile and run a sandbox application.</li>
          </ol>
          <small>
            We won’t invent experience or qualifications. If a required answer is missing, we’ll
            stop the application.
          </small>
        </aside>
      </div>
    </>
  )
}
