import { isApplicationReady } from '@/lib/resume/completeness'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, desc, eq } from 'drizzle-orm'
import { ArrowLeft, MapPin, BriefcaseBusiness, Sparkles } from 'lucide-react'
import { db } from '@/db/client'
import { profiles, applications, savedJobs } from '@/db/schema'
import { requireUser } from '@/lib/session'
import { getJobs } from '@/lib/jobs'
import { ApplyButton, SaveButton } from '@/components/JobActions'
export default async function JobPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const user = await requireUser(),
    { slug } = await params
  const job = (await getJobs()).find((j) => j.slug === slug)
  if (!job) notFound()
  const profile = db
    .select()
    .from(profiles)
    .where(and(eq(profiles.userId, user.id), eq(profiles.archived, false)))
    .orderBy(desc(profiles.isDefault), desc(profiles.createdAt))
    .all()
    .find(isApplicationReady)
  const existing = db
    .select()
    .from(applications)
    .where(and(eq(applications.userId, user.id), eq(applications.jobId, slug)))
    .orderBy(desc(applications.createdAt))
    .get()
  const saved = db
    .select()
    .from(savedJobs)
    .where(and(eq(savedJobs.userId, user.id), eq(savedJobs.jobId, slug)))
    .get()
  return (
    <>
      <Link href="/jobs" className="back-link">
        <ArrowLeft size={16} /> All sandbox jobs
      </Link>
      <div className="detail-layout">
        <article className="surface job-detail">
          <div className="spread">
            <span className="company-mark large-mark purple">{job.mark}</span>
            <SaveButton jobId={slug} saved={!!saved} />
          </div>
          <p className="company-name">{job.company}</p>
          <h1>{job.role}</h1>
          <div className="detail-meta">
            <span>
              <MapPin size={16} />
              {job.location}
            </span>
            <span>
              <BriefcaseBusiness size={16} />
              {job.employmentType}
            </span>
            <span className="tag">{job.department}</span>
          </div>
          <hr />
          <h2>Meet {job.company}</h2>
          <p>{job.about}</p>
          <h2>What you’ll work on</h2>
          <ul className="responsibilities">
            {job.responsibilities.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <div className="notice">
            <Sparkles size={18} />
            <span>
              This is a fictional sandbox role. Try a real application flow
              without contacting an employer.
            </span>
          </div>
        </article>
        <aside>
          <div className="aside-card apply-card">
            <span className="mini-icon">
              <Sparkles size={21} />
            </span>
            <h2>Test Auto Apply on this job.</h2>
            <p>
              Start the API flow with your reviewed profile. The background
              worker discovers fields, prepares answers, and tracks the result.
            </p>
            <div className="selected-resume">
              <span>APPLYING WITH</span>
              <strong>{profile?.name ?? 'Add a reviewed resume'}</strong>
              <Link href="/profiles">Manage resumes</Link>
            </div>
            <ApplyButton
              jobId={slug}
              profileId={profile?.id}
              available={job.available}
              existingId={existing?.id}
            />
            <small>
              We only use facts you’ve provided. If something’s missing, we stop
              and let you know.
            </small>
          </div>
        </aside>
      </div>
    </>
  )
}
