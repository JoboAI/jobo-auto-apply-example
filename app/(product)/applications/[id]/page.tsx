import { isApplicationReady } from '@/lib/resume/completeness'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, desc, eq } from 'drizzle-orm'
import { ArrowLeft, Check, Circle, FileText, Sparkles } from 'lucide-react'
import { db } from '@/db/client'
import { applications, profiles, steps, apiExchanges } from '@/db/schema'
import { requireUser } from '@/lib/session'
import { isTerminal } from '@/lib/status'
import { applicationLabel, canRetry, displayDate } from '@/lib/presentation'
import { LiveRefresh, CancelButton } from '@/components/ApplicationLive'
import { liveVersion } from '@/lib/live-version'
import { ApplyButton } from '@/components/JobActions'
import { ApplicationApiPreview } from '@/components/ApplicationApiPreview'
import { ApplicationAnswers } from '@/components/ApplicationAnswers'
import { ProductionJobLink, SandboxJobLink } from '@/components/SandboxJobLink'
import { atsLogo } from '@/lib/jobo/supported-ats'
import { fullName } from '@/lib/resume/profile-schema'
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireUser(),
    { id } = await params
  const [row] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.id, id), eq(applications.userId, user.id)))
    .limit(1)
  if (!row) notFound()
  const history = await db
    .select()
    .from(steps)
    .where(eq(steps.applicationId, id))
    .orderBy(asc(steps.receivedAt))
  const exchanges = await db.select().from(apiExchanges)
    .where(eq(apiExchanges.applicationId, id)).orderBy(asc(apiExchanges.startedAt)).limit(100)
  const profile = (
    await db
      .select()
      .from(profiles)
      .where(and(eq(profiles.userId, user.id), eq(profiles.archived, false)))
      .orderBy(desc(profiles.isDefault))
  ).find(isApplicationReady)
  const active = !isTerminal(row.status),
    label = applicationLabel(row),
    submitted = row.status === 'submitted'
  return (
    <>
      <Link href="/applications" className="back-link">
        <ArrowLeft size={16} /> All applications
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">AUTO APPLY API · APPLICATION RUN</div>
          <h1>{row.jobSnapshot?.role ?? (row.sandbox ? 'Sandbox application' : 'Application')}</h1>
          <p>
            {row.jobSnapshot?.company} · {row.jobSnapshot?.location}
          </p>
        </div>
        <LiveRefresh id={id} active={active} version={liveVersion(row, history, exchanges)} />
      </div>
      <div className="detail-layout">
        <section className="surface application-detail">
          <div className="spread">
            <span className={`status-badge status-${row.status}`}>{label}</span>
            <time className="subtle">{displayDate(row.createdAt)}</time>
          </div>
          <h2>
            {submitted
              ? 'Submission confirmed by the API.'
              : row.status === 'recovery_required'
                ? 'We’re checking what happened.'
                : active
                  ? 'Auto Apply is running.'
                  : label === 'Canceled'
                    ? 'Application canceled.'
                    : 'Application could not complete.'}
          </h2>
          <p>
            {submitted
              ? row.sandbox
                ? 'Your sandbox application was confirmed as submitted.'
                : 'Your application was submitted to the employer through your Jobo account.'
              : row.stopReason ||
                row.failureMessage ||
                (active
                  ? 'You can leave this page. Your application keeps running in the background.'
                  : 'This application was not completed. Your other applications are unaffected.')}
          </p>
          {row.workerError && active && (
            <div className="notice warning">
              We hit a temporary connection issue. We’re checking the
              application safely before continuing.
            </div>
          )}
          {history.some(step => step.answersJson?.length) && (
            <a href="#answers-sent-heading" className="button secondary small answer-jump">View answers sent</a>
          )}
          <ol className="timeline">
            <li>
              <span className="timeline-dot complete">
                <Check size={14} />
              </span>
              <div>
                <strong>Application queued</strong>
                <p>
                  Your reviewed profile and resume were saved for this
                  application.
                </p>
              </div>
            </li>
            <li>
              <span
                className={`timeline-dot ${history.length || submitted ? 'complete' : ''}`}
              >
                {history.length || submitted ? (
                  <Check size={14} />
                ) : (
                  <Circle size={12} />
                )}
              </span>
              <div>
                <strong>Preparing your answers</strong>
                <p>Mapping confirmed candidate data to the fields discovered by the API.</p>
              </div>
            </li>
            {history.map((step, i) => (
              <li key={`${step.stepId}-${step.correctionRound}`}>
                <span
                  className={`timeline-dot ${step.submittedAt ? 'complete' : ''}`}
                >
                  {step.submittedAt ? (
                    <Check size={14} />
                  ) : (
                    <Circle size={12} />
                  )}
                </span>
                <div>
                  <strong>
                    Application step {step.sequence}
                    {step.correctionRound > 0
                      ? ` · revision ${step.correctionRound}`
                      : ''}
                  </strong>
                  <p>
                    {step.error
                      ? 'This step could not be completed with the available information.'
                      : step.submittedAt
                        ? 'Answers sent successfully.'
                        : 'Preparing answers from your saved profile.'}
                  </p>
                  <time>{displayDate(step.receivedAt)}</time>
                </div>
              </li>
            ))}
            <li>
              <span className={`timeline-dot ${submitted ? 'complete' : ''}`}>
                {submitted ? <Check size={14} /> : <Circle size={12} />}
              </span>
              <div>
                <strong>
                  {submitted
                    ? 'Submission confirmed'
                    : 'Submission confirmation'}
                </strong>
                <p>
                  {submitted
                    ? 'The application service confirmed your submission.'
                    : 'We only mark an application submitted once it’s confirmed.'}
                </p>
              </div>
            </li>
          </ol>
          {active && <CancelButton id={id} requested={row.cancelRequested} />}
          <div className="notice">
            <Sparkles size={17} />
            <span>
              {row.sandbox
                ? 'Sandbox application — no real employer is contacted.'
                : 'Production application — sent to a real employer on your own Jobo API key.'}
            </span>
          </div>
        </section>
        <aside>
          <div className="aside-card">
            <span className="mini-icon">
              <FileText size={22} />
            </span>
            <h3>Candidate snapshot</h3>
            {row.sandbox ? (
              <SandboxJobLink url={row.applyUrl} slug={row.jobId ?? ''} title={row.jobSnapshot?.role ?? 'application'} />
            ) : (
              <ProductionJobLink url={row.jobSnapshot?.listingUrl ?? row.applyUrl} ats={row.jobSnapshot?.sourceName} atsLogoUrl={atsLogo(row.jobSnapshot?.source)} title={row.jobSnapshot?.role ?? 'application'} />
            )}
            <p>{row.profileSnapshot?.resumeFilename}</p>
            <dl className="snapshot-details">
              <dt>Name</dt>
              <dd>{row.profileSnapshot ? fullName(row.profileSnapshot.data) : null}</dd>
              <dt>Email</dt>
              <dd>{row.profileSnapshot?.data.personal.email}</dd>
            </dl>
            <small>
              This application uses the profile you confirmed when you clicked
              Apply.
            </small>
            {canRetry(row) && row.jobId && (
              <div className="retry-area">
                <p>
                  Updated your profile? You can try again with your current
                  resume.
                </p>
                <ApplyButton
                  jobId={row.jobId}
                  profileId={profile?.id}
                  available={true}
                  retry
                />
              </div>
            )}
          </div>
        </aside>
      </div>
      <ApplicationApiPreview exchanges={exchanges} />
      <ApplicationAnswers history={history} />
    </>
  )
}
