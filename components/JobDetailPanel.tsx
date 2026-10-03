import { Check, Code2, Gift, GraduationCap, MapPin, Award, Sparkles, X } from 'lucide-react'
import type { Job } from '@/lib/jobs-types'
import type { JobDetail, QualificationSet } from '@/lib/jobo/jobs-api'
import { highlightJson } from '@/lib/json-highlight'
import { curlCommand } from '@/lib/jobo/api-preview'
import { AtsBadge } from './AtsBadge'
import { CodeBlock } from './CodeBlock'

function SkillTags({ skills, link = true }: { skills: string[]; link?: boolean }) {
  return (
    <div className="tag-row skill-row">
      {skills.map((skill) =>
        link ? (
          <a key={skill} className="tag" href={`/jobs?skill=${encodeURIComponent(skill)}`}>
            {skill}
          </a>
        ) : (
          <span key={skill} className="tag">
            {skill}
          </span>
        ),
      )}
    </div>
  )
}

const isEmpty = (q: QualificationSet) =>
  !q.skills.length && !q.softSkills.length && !q.education.length && !q.certifications.length

function Qualifications({ title, set }: { title: string; set: QualificationSet }) {
  return (
    <div className="qualification-set">
      <h3>{title}</h3>
      {set.skills.length > 0 && <SkillTags skills={set.skills} />}
      {set.softSkills.length > 0 && (
        <>
          <h4>Soft skills</h4>
          <SkillTags skills={set.softSkills} link={false} />
        </>
      )}
      {set.education.length > 0 && (
        <ul className="icon-list">
          {set.education.map((e) => (
            <li key={e}>
              <GraduationCap size={15} /> {e}
            </li>
          ))}
        </ul>
      )}
      {set.certifications.length > 0 && (
        <ul className="icon-list">
          {set.certifications.map((c) => (
            <li key={c}>
              <Award size={15} /> {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The "Job details" tab. Sandbox jobs have no `detail` and keep the short
 * layout; production jobs show everything `GET /api/jobs/{id}` returned.
 */
export function JobDetailPanel({
  job,
  detail,
  raw,
  url,
  showCompanySummary,
}: {
  job: Job
  detail?: JobDetail
  raw?: unknown
  url?: string
  /** No company tab on this page, so the job's own company blurb goes here. */
  showCompanySummary?: boolean
}) {
  const production = !!job.production
  const notice = (
    <div className={`notice ${production ? 'warning' : ''}`}>
      <Sparkles size={18} />
      <span>
        {production
          ? `This is a real job on ${job.sourceName ?? 'the employer’s ATS'}. Applying submits your profile to the employer on your own Jobo API key.`
          : 'This is a fictional sandbox role. Try a real application flow without contacting an employer.'}
      </span>
    </div>
  )
  const responsibilities = job.responsibilities.length > 0 && (
    <>
      <h2>What you’ll work on</h2>
      <ul className="responsibilities">
        {job.responsibilities.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </>
  )

  if (!detail)
    return (
      <>
        <h2>Meet {job.company}</h2>
        <p>{job.about}</p>
        {!!job.skills?.length && (
          <>
            <h2>Must-have skills</h2>
            <SkillTags skills={job.skills} />
          </>
        )}
        {responsibilities}
        {notice}
      </>
    )

  const facts: { label: string; value: React.ReactNode }[] = []
  const fact = (label: string, value: React.ReactNode | undefined) =>
    value && facts.push({ label, value })
  fact('Pay', detail.pay ?? job.salary)
  fact('Employment', job.employmentType !== 'Not specified' ? job.employmentType : undefined)
  fact('Seniority', job.experienceLevel)
  fact('Work model', job.workModel)
  fact(
    'Posted',
    detail.postedOn && `${detail.postedOn}${job.postedAgo ? ` · ${job.postedAgo.toLowerCase()}` : ''}`,
  )
  fact('Closes', detail.closesOn)
  fact('Updated', detail.updatedAgo)
  fact('Hiring through', job.sourceName && <AtsBadge name={job.sourceName} logoUrl={job.sourceLogoUrl} />)
  fact('Requisition ID', detail.externalId && <code>{detail.externalId}</code>)
  fact('Normalized title', detail.normalizedTitle)

  const json = raw === undefined ? '' : JSON.stringify(raw, null, 2)
  return (
    <>
      {detail.summary && <p className="job-lead">{detail.summary}</p>}
      {facts.length > 0 && (
        <dl className="job-facts">
          {facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {detail.eligibility.length > 0 && (
        <ul className="eligibility" aria-label="Eligibility">
          {detail.eligibility.map((e) => (
            <li key={e.label} className={e.value ? 'yes' : 'no'}>
              {e.value ? <Check size={14} /> : <X size={14} />}
              <span>
                {e.label}: <strong>{e.value ? 'Yes' : 'No'}</strong>
              </span>
            </li>
          ))}
        </ul>
      )}
      {showCompanySummary && detail.companySummary && (
        <>
          <h2>Meet {job.company}</h2>
          <p>{detail.companySummary}</p>
        </>
      )}
      <h2>About the role</h2>
      {detail.description.length > 0 ? (
        <div className="job-description">
          {detail.description.map((block, i) =>
            block.kind === 'heading' ? (
              <h3 key={i}>{block.text}</h3>
            ) : block.kind === 'list' ? (
              <ul key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            ) : (
              <p key={i}>{block.text}</p>
            ),
          )}
        </div>
      ) : (
        <p>{job.about}</p>
      )}
      {responsibilities}
      {(!isEmpty(detail.mustHave) || !isEmpty(detail.preferred)) && (
        <>
          <h2>Qualifications</h2>
          <div className="qualifications">
            {!isEmpty(detail.mustHave) && <Qualifications title="Must have" set={detail.mustHave} />}
            {!isEmpty(detail.preferred) && <Qualifications title="Nice to have" set={detail.preferred} />}
          </div>
        </>
      )}
      {detail.benefits.length > 0 && (
        <>
          <h2>Benefits</h2>
          <ul className="benefit-list">
            {detail.benefits.map((b) => (
              <li key={b}>
                <Gift size={15} /> {b}
              </li>
            ))}
          </ul>
        </>
      )}
      {detail.locations.length > 1 && (
        <>
          <h2>Locations</h2>
          <div className="tag-row location-row">
            {detail.locations.map((l) => (
              <span key={l.label} className="tag">
                {l.flag ? <span aria-hidden="true">{l.flag}</span> : <MapPin size={12} />} {l.label}
              </span>
            ))}
          </div>
        </>
      )}
      {notice}
      {url && json && (
        <details className="api-call">
          <summary>
            <Code2 size={16} /> See the raw API response for this job
          </summary>
          <p>
            Everything on this tab comes from one free request,{' '}
            <code>GET /api/jobs/&#123;id&#125;</code>, made with your API key.
          </p>
          <CodeBlock
            title="GET /api/jobs/{id}"
            note="200 OK"
            copy={curlCommand('GET', url, { headers: [], body: null, truncated: false })}
            copyLabel="Copy as cURL"
            label="Job API response"
          >
            {highlightJson(json)}
          </CodeBlock>
        </details>
      )}
    </>
  )
}
