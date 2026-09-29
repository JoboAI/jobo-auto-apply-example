'use client'

import { Check, ShieldCheck } from 'lucide-react'
import type { ResumeProfile } from '@/lib/resume/profile-schema'
import { contactIssues } from '@/lib/resume/completeness'

type Props = { profile: ResumeProfile; onChange: (profile: ResumeProfile) => void }

export function ContactFields({ profile, onChange }: Props) {
  const issues = contactIssues(profile)
  const missing = Object.values(issues).filter(Boolean).length
  const linkedin = profile.links.find((link) => link.type === 'linkedin')?.url ?? ''
  const personal = (key: keyof ResumeProfile['personal'], value: string) => {
    const [first = '', ...rest] = value.trim().split(/\s+/)
    onChange({ ...profile, personal: { ...profile.personal, [key]: value,
      ...(key === 'full_name' ? { first_name: first, last_name: rest.join(' ') } : {}),
    } })
  }
  return (
    <section className="surface editor-section setup-panel" aria-labelledby="contact-heading">
      <div className="setup-panel-heading">
        <div><div className="eyebrow">01 · CONTACT DETAILS</div><h2 id="contact-heading">Fill the gaps. Keep it yours.</h2></div>
        <span className={`setup-count ${missing ? '' : 'complete'}`} aria-live="polite">
          {missing ? `${missing} to complete` : <><Check size={15} /> All set</>}
        </span>
      </div>
      <p>We’ve filled in what we found in your resume. These four details are required to try Auto Apply.</p>
      <div className="editor-fields">
        <label>Full name <span className="field-requirement">Required</span>
          <input name="full_name" autoComplete="name" required value={profile.personal.full_name}
            data-missing={!!issues.name} onChange={(e) => personal('full_name', e.target.value)} />
        </label>
        <label>Email address <span className="field-requirement">Required</span>
          <input name="email" type="email" autoComplete="email" required value={profile.personal.email}
            data-missing={!!issues.email} onChange={(e) => personal('email', e.target.value)} />
        </label>
        <label>Phone number <span className="field-requirement">Required</span>
          <input name="phone" type="tel" autoComplete="tel" required placeholder="+1 415 555 0123"
            value={profile.personal.phone ?? ''} data-missing={!!issues.phone}
            onChange={(e) => personal('phone', e.target.value)} aria-describedby="phone-help" />
          <small id="phone-help">Include the country code so forms can use it correctly.</small>
        </label>
        <label>LinkedIn profile <span className="field-requirement">Required</span>
          <input name="linkedin" type="url" required placeholder="https://www.linkedin.com/in/your-name"
            value={linkedin} data-missing={!!issues.linkedin} aria-describedby="linkedin-help"
            onChange={(e) => {
              const links = profile.links.filter((link) => link.type !== 'linkedin')
              onChange({ ...profile, links: [{ label: 'LinkedIn', type: 'linkedin', url: e.target.value }, ...links] })
            }} />
          <small id="linkedin-help">Use your personal LinkedIn profile, starting with https://.</small>
        </label>
      </div>
    </section>
  )
}

export function CommonAnswerFields({ profile, onChange }: Props) {
  const location = (key: keyof ResumeProfile['location'], value: string) => {
    const countryName = /^[A-Z]{2}$/.test(value)
      ? new Intl.DisplayNames(['en'], { type: 'region' }).of(value) : null
    onChange({ ...profile, location: { ...profile.location, [key]: value || null,
      ...(key === 'country_code' ? { country_name: countryName ?? null } : {}),
    } })
  }
  const authorization = (patch: Partial<ResumeProfile['work_authorization']>) =>
    onChange({ ...profile, work_authorization: { ...profile.work_authorization, ...patch } })
  const preference = (patch: Partial<ResumeProfile['preferences']>) =>
    onChange({ ...profile, preferences: { ...profile.preferences, ...patch } })
  return (
    <>
      <section className="surface editor-section setup-panel" aria-labelledby="answers-heading">
        <div className="eyebrow">02 · COMMON APPLICATION ANSWERS</div>
        <h2 id="answers-heading">A few answers your resume may not have.</h2>
        <p>Recommended for smoother runs. Only provide answers you know. If a job requires a missing answer, the demo stops and explains why.</p>
        <div className="editor-fields">
          <label>City<input autoComplete="address-level2" value={profile.location.city ?? ''}
            placeholder="e.g. Amsterdam" onChange={(e) => location('city', e.target.value)} /></label>
          <label>Country code<input autoComplete="country" maxLength={2} pattern="[A-Za-z]{2}"
            placeholder="e.g. NL, US, GB" value={profile.location.country_code ?? ''}
            onChange={(e) => location('country_code', e.target.value.toUpperCase())} /></label>
          <label>Countries you’re authorized to work in
            <input placeholder="e.g. NL, DE" defaultValue={profile.work_authorization.authorized_country_codes.join(', ')} pattern="[A-Za-z]{2}([, ]+[A-Za-z]{2})*"
              onChange={(e) => authorization({ authorized_country_codes: e.target.value.toUpperCase().split(/[,\s]+/).filter(Boolean) })} />
            <small>Country codes. Leave blank if you’re unsure.</small>
          </label>
          <label>Do you need visa sponsorship?
            <select value={profile.work_authorization.requires_sponsorship === null ? '' : String(profile.work_authorization.requires_sponsorship)}
              onChange={(e) => authorization({ requires_sponsorship: e.target.value === '' ? null : e.target.value === 'true' })}>
              <option value="">Not answered</option><option value="true">Yes</option><option value="false">No</option>
            </select>
          </label>
          <label>Notice period (days)
            <input type="number" min={0} step={1} placeholder="e.g. 30" value={profile.work_authorization.notice_period_days ?? ''}
              onChange={(e) => authorization({ notice_period_days: e.target.value === '' ? null : Number(e.target.value) })} />
          </label>
          <label>Earliest start date<input type="date" value={profile.preferences.earliest_start_date ?? ''}
            onChange={(e) => preference({ earliest_start_date: e.target.value || null })} /></label>
          <label>Workplace preference
            <select value={profile.preferences.remote_preference ?? ''}
              onChange={(e) => preference({ remote_preference: e.target.value as ResumeProfile['preferences']['remote_preference'] || null })}>
              <option value="">Not answered</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option><option value="no_preference">No preference</option>
            </select>
          </label>
          <label>Are you willing to relocate?
            <select value={profile.preferences.willing_to_relocate === null ? '' : String(profile.preferences.willing_to_relocate)}
              onChange={(e) => preference({ willing_to_relocate: e.target.value === '' ? null : e.target.value === 'true' })}>
              <option value="">Not answered</option><option value="true">Yes</option><option value="false">No</option>
            </select>
          </label>
        </div>
      </section>
      <section className="surface editor-section setup-panel eeo-panel" aria-labelledby="eeo-heading">
        <div className="setup-panel-heading"><h2 id="eeo-heading"><ShieldCheck size={21} /> EEO & self-identification</h2><span className="tag">Voluntary</span></div>
        <p>This demo doesn’t collect or infer race, gender, disability, or veteran status. Choose how it handles those questions on application forms.</p>
        <label>Self-identification preference
          <select value={profile.self_identification ?? 'decline'}
            onChange={(e) => onChange({ ...profile, self_identification: e.target.value as 'decline' | 'leave_blank' })}>
            <option value="decline">Choose “prefer not to answer” when available</option>
            <option value="leave_blank">Leave these questions unanswered</option>
          </select>
        </label>
        <small>If the form requires an answer we can’t provide with your preference, the run stops. These questions are never sent to the answer model.</small>
      </section>
    </>
  )
}
