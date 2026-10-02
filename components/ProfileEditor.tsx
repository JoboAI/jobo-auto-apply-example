'use client'
import { useRef, useState } from 'react'
import { pushWithFallback, useBusy } from '@/lib/use-busy'
import { useRouter } from 'next/navigation'
import { Check, Plus, Trash2, ArrowRight } from 'lucide-react'
import type { ResumeProfile } from '@/lib/resume/profile-schema'
import { ContactFields, CommonAnswerFields } from './ProfileSetupFields'
import { contactIssues } from '@/lib/resume/completeness'
import { updateProfileAction } from '@/app/actions/profiles'
type Value =
  string | number | boolean | null | Value[] | { [key: string]: Value }
type RecordValue = { [key: string]: Value }
const titles: Record<string, string> = {
  personal: 'The essentials',
  location: 'Where you’re based',
  links: 'Find you online',
  work_experience: 'Your experience',
  education: 'Your education',
  skills: 'What you do best',
  languages: 'Languages',
  certifications: 'Certifications',
  work_authorization: 'Work authorization',
  preferences: 'Your next role',
  about: 'Candidate summary',
  country_code: 'Country code (e.g. NL)',
  authorized_country_codes: 'Countries you can work in (codes, one per line)',
  requires_sponsorship: 'Do you need sponsorship?',
  remote_preference: 'Workplace preference',
  full_name: 'Full name',
  freeform_notes: 'Anything else Jobo should know',
  notice_period_days: 'Notice period (days)',
  desired_salary: 'Desired salary',
  salary_currency: 'Salary currency (e.g. EUR)',
}
const templates: Record<string, RecordValue> = {
  links: { label: '', type: 'website', url: '' },
  work_experience: {
    company: '',
    title: '',
    employment_type: null,
    location: null,
    start_date: '',
    end_date: null,
    is_current: false,
    description: '',
  },
  education: {
    school: '',
    degree: null,
    field_of_study: null,
    start_date: null,
    end_date: null,
    is_current: false,
    grade: null,
  },
  skills: { name: '', level: null },
  languages: { name: '', proficiency: null },
  certifications: { name: '', issuer: null, issued: null },
}
const label = (key: string) =>
  titles[key] ?? key.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase())
const booleans = new Set([
  'is_current',
  'requires_sponsorship',
  'willing_to_relocate',
])
const numbers = new Set(['desired_salary', 'notice_period_days'])
const longText = new Set([
  'description',
  'summary',
  'motivation',
  'freeform_notes',
])
function Fields({
  value,
  onChange,
}: {
  value: RecordValue
  onChange: (v: RecordValue) => void
}) {
  return (
    <div className="editor-fields">
      {Object.entries(value).map(([key, v]) => {
        const change = (next: Value) => onChange({ ...value, [key]: next })
        if (Array.isArray(v)) {
          if (templates[key])
            return (
              <div className="array-section" key={key}>
                {v.map((item, i) => (
                  <div className="array-item" key={i}>
                    <div className="spread">
                      <strong>
                        {label(key)} {i + 1}
                      </strong>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remove ${label(key)} ${i + 1}`}
                        onClick={() => change(v.filter((_, n) => n !== i))}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <Fields
                      value={item as RecordValue}
                      onChange={(next) =>
                        change(v.map((old, n) => (n === i ? next : old)))
                      }
                    />
                  </div>
                ))}
                <button
                  className="button secondary small"
                  type="button"
                  onClick={() => change([...v, { ...templates[key] }])}
                >
                  <Plus size={15} />
                  Add {label(key).toLowerCase()}
                </button>
              </div>
            )
          return (
            <label key={key} className="wide-field">
              {label(key)}
              <textarea
                rows={3}
                value={v.join('\n')}
                placeholder="One per line"
                onChange={(e) => change(e.target.value.split('\n'))}
              />
            </label>
          )
        }
        if (v && typeof v === 'object')
          return <Fields key={key} value={v} onChange={change} />
        if (booleans.has(key))
          return (
            <label key={key}>
              {label(key)}
              <select
                value={v === null ? '' : String(v)}
                onChange={(e) =>
                  change(
                    e.target.value === '' ? null : e.target.value === 'true',
                  )
                }
              >
                <option value="">Not specified</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
          )
        if (key === 'remote_preference' || key === 'type')
          return (
            <label key={key}>
              {label(key)}
              <select
                value={String(v ?? '')}
                onChange={(e) => change(e.target.value || null)}
              >
                <option value="">Not specified</option>
                {(key === 'type'
                  ? ['linkedin', 'github', 'portfolio', 'website', 'other']
                  : ['remote', 'hybrid', 'onsite', 'no_preference']
                ).map((o) => (
                  <option key={o} value={o}>
                    {label(o)}
                  </option>
                ))}
              </select>
            </label>
          )
        return (
          <label key={key} className={longText.has(key) ? 'wide-field' : ''}>
            {label(key)}
            {longText.has(key) ? (
              <textarea
                rows={4}
                value={String(v ?? '')}
                onChange={(e) => change(e.target.value)}
              />
            ) : (
              <input
                type={
                  numbers.has(key)
                    ? 'number'
                    : key === 'email'
                      ? 'email'
                      : 'text'
                }
                value={String(v ?? '')}
                placeholder={key.endsWith('_date') ? 'YYYY-MM' : ''}
                onChange={(e) =>
                  change(
                    numbers.has(key)
                      ? e.target.value === ''
                        ? null
                        : Number(e.target.value)
                      : e.target.value || (v === null ? null : ''),
                  )
                }
              />
            )}
          </label>
        )
      })}
    </div>
  )
}
export function ProfileEditor({
  id,
  data,
  name,
  reviewed,
}: {
  id: string
  data: ResumeProfile
  name: string
  reviewed: boolean
}) {
  const [profile, setProfile] = useState(data),
    [profileName, setName] = useState(name),
    [error, setError] = useState(''),
    [pending, start] = useBusy(),
    [saved, setSaved] = useState(false),
    [step, setStep] = useState(0),
    router = useRouter()
  const stepHeading = useRef<HTMLHeadingElement>(null)
  const changeProfile = (next: ResumeProfile) => { setSaved(false); setError(''); setProfile(next) }
  const goTo = (next: number) => {
    setStep(next)
    setError('')
    requestAnimationFrame(() => stepHeading.current?.focus())
  }
  const missing = Object.values(contactIssues(profile)).filter(Boolean)
  return (
    <form onSubmit={(e) => {
      e.preventDefault()
      if ((step === 0 || step === 2) && missing.length) {
        setStep(0)
        setError(missing.join(' '))
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[data-missing="true"]')?.focus())
        return
      }
      start(async () => {
        setError('')
        try {
          const result = await updateProfileAction(id, {
            name: profileName,
            data: profile,
            confirm: step === 2,
          })
          if (!result.ok) setError(result.error ?? 'Could not save.')
          else if (step < 2) goTo(step + 1)
          else {
            setSaved(true)
            if (!reviewed) pushWithFallback(router, '/jobs')
            else router.refresh()
          }
        } catch {
          setError('Could not save your profile. Please try again.')
        }
      })
    }}>
      <ol className="profile-steps" aria-label="Profile setup progress">
        {['Contact details', 'Application answers', 'Review & confirm'].map((title, index) => (
          <li key={title} aria-current={step === index ? 'step' : undefined} data-complete={step > index}>
            <span>{step > index ? <Check size={15} /> : `0${index + 1}`}</span>{title}
          </li>
        ))}
      </ol>
      <h2 className="sr-only" tabIndex={-1} ref={stepHeading}>Step {step + 1}: {['Contact details', 'Application answers', 'Review and confirm'][step]}</h2>
      {step === 0 && <ContactFields profile={profile} onChange={changeProfile} />}
      {step === 1 && <CommonAnswerFields profile={profile} onChange={changeProfile} />}
      {step === 2 && <>
        <div className="notice"><Check size={18} /><span>
          {reviewed
            ? 'Changes apply to future applications. Applications already started keep their original resume.'
            : 'Your contact details are ready. Check the extracted experience, education, and skills before confirming.'}
        </span></div>
        <div className="surface editor-section setup-panel">
          <div className="eyebrow">03 · YOUR REVIEWED PROFILE</div>
          <h2>The facts behind every answer.</h2>
          <p>Open any section to correct the resume extraction. No experience or qualifications are added for you.</p>
          <label>Resume name<input value={profileName} onChange={(e) => { setSaved(false); setName(e.target.value) }} required maxLength={100} /></label>
        </div>
        {Object.entries(profile).filter(([key]) => key !== 'self_identification').map(([key, value], i) => (
          <details className="surface editor-section" key={key} open={key === 'work_experience' || undefined}>
            <summary><span className="section-number">{String(i + 1).padStart(2, '0')}</span>{label(key)}<span className="subtle">Edit details</span></summary>
            <Fields value={Array.isArray(value) ? { [key]: value as Value } : value as RecordValue}
              onChange={(next) => changeProfile({ ...profile, [key]: Array.isArray(value) ? next[key] : next })} />
          </details>
        ))}
      </>}
      <div className="editor-save">
        <div>
          {error && <p role="alert" className="inline-error">{error}</p>}
          {saved && <p role="status">Your profile is saved.</p>}
          <p className="subtle">{step < 2 ? 'Continue saves your progress. You can edit these answers later.' : 'Confirm only the information you’re happy to use in applications.'}</p>
        </div>
        <div className="setup-actions">
          {step > 0 && <button type="button" className="button secondary" disabled={pending} onClick={() => goTo(step - 1)}>Back</button>}
          <button className="button primary" disabled={pending}>
            {pending ? 'Saving…' : step === 0 ? 'Continue to application answers' : step === 1 ? 'Review extracted resume' : reviewed ? 'Save changes' : 'Confirm profile & discover jobs'}
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </form>
  )
}
