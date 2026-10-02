'use client'
import { useRef, useState } from 'react'
import { pushWithFallback, useBusy } from '@/lib/use-busy'
import { useRouter } from 'next/navigation'
import { Check, Plus, Trash2, ArrowRight } from 'lucide-react'
import {
  degreeOptions,
  jobTypeOptions,
  skillYearsOptions,
  type ResumeProfile,
} from '@/lib/resume/profile-schema'
import { EmploymentFields, PersonalFields, PreferenceFields } from './ProfileSetupFields'
import { contactIssues, employmentIssues } from '@/lib/resume/completeness'
import { updateProfileAction } from '@/app/actions/profiles'
type Value =
  string | number | boolean | null | Value[] | { [key: string]: Value }
type RecordValue = { [key: string]: Value }
/** The resume-backed sections, edited in the review step. */
const reviewSections = ['experience', 'education', 'projects', 'skills', 'languages'] as const
const STEPS = ['Personal info', 'Employment info', 'Job preferences', 'Review & confirm']
const LAST = STEPS.length - 1
const titles: Record<string, string> = {
  experience: 'Work experience',
  education: 'Education',
  projects: 'Projects',
  skills: 'Skills',
  languages: 'Languages',
  major: 'Major / field of study',
  gpa: 'GPA',
  grad_month: 'Graduation month',
  grad_year: 'Graduation year',
  type: 'Employment type',
  currently_working: 'I currently work here',
  years: 'Years of experience',
  favorite: 'Favorite skill',
  link: 'Link',
  title: 'Title',
}
const templates: Record<string, RecordValue> = {
  experience: {
    company: '',
    title: '',
    location: null,
    type: null,
    start_month: null,
    start_year: null,
    end_month: null,
    end_year: null,
    currently_working: false,
    description: '',
  },
  education: {
    school: '',
    degree: 'bachelors',
    major: null,
    gpa: null,
    start_month: null,
    start_year: null,
    grad_month: null,
    grad_year: null,
  },
  projects: {
    name: '',
    title: null,
    location: null,
    start_month: null,
    start_year: null,
    end_month: null,
    end_year: null,
    currently_working: false,
    description: '',
    link: null,
  },
  skills: { name: '', years: null, favorite: false },
}
const MONTHS = Array.from({ length: 12 }, (_, i) => [
  String(i + 1),
  new Date(Date.UTC(2000, i, 1)).toLocaleString('en', { month: 'long', timeZone: 'UTC' }),
] as const)
/** Select fields, with whether "Not specified" is allowed. */
const enums: Record<string, { options: readonly (readonly [string, string])[]; nullable: boolean }> = {
  degree: { options: degreeOptions, nullable: false },
  type: { options: jobTypeOptions, nullable: true },
  years: { options: skillYearsOptions, nullable: true },
}
const label = (key: string) =>
  titles[key] ?? key.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase())
const booleans = new Set(['currently_working', 'favorite'])
const isNumber = (key: string) => key === 'gpa' || key.endsWith('_year')
const longText = new Set(['description'])
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
            <label key={key} className="choice">
              <input
                type="checkbox"
                checked={v === true}
                onChange={(e) => change(e.target.checked)}
              />
              {label(key)}
            </label>
          )
        if (enums[key] || key.endsWith('_month')) {
          const { options, nullable } = enums[key] ?? { options: MONTHS, nullable: true }
          const numeric = key.endsWith('_month')
          return (
            <label key={key}>
              {label(key)}
              <select
                value={String(v ?? '')}
                onChange={(e) =>
                  change(
                    e.target.value === ''
                      ? null
                      : numeric
                        ? Number(e.target.value)
                        : e.target.value,
                  )
                }
              >
                {nullable && <option value="">Not specified</option>}
                {options.map(([o, text]) => (
                  <option key={o} value={o}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          )
        }
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
                type={isNumber(key) ? 'number' : key === 'link' ? 'url' : 'text'}
                step={key === 'gpa' ? 0.01 : undefined}
                value={String(v ?? '')}
                onChange={(e) =>
                  change(
                    isNumber(key)
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
  const contactMissing = Object.values(contactIssues(profile)).filter(Boolean)
  const employmentMissing = Object.values(employmentIssues(profile)).filter(Boolean)
  return (
    <form onSubmit={(e) => {
      e.preventDefault()
      // Each gate sends you back to the step that owns the missing answers.
      const gate =
        (step === 0 || step === LAST) && contactMissing.length ? { at: 0, missing: contactMissing }
          : (step === 1 || step === LAST) && employmentMissing.length ? { at: 1, missing: employmentMissing }
            : null
      if (gate) {
        setStep(gate.at)
        setError(gate.missing.join(' '))
        requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-missing="true"]')?.focus())
        return
      }
      start(async () => {
        setError('')
        try {
          const result = await updateProfileAction(id, {
            name: profileName,
            data: profile,
            confirm: step === LAST,
          })
          if (!result.ok) setError(result.error ?? 'Could not save.')
          else if (step < LAST) goTo(step + 1)
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
        {STEPS.map((title, index) => (
          <li key={title} aria-current={step === index ? 'step' : undefined} data-complete={step > index}>
            <span>{step > index ? <Check size={15} /> : `0${index + 1}`}</span>{title}
          </li>
        ))}
      </ol>
      <h2 className="sr-only" tabIndex={-1} ref={stepHeading}>Step {step + 1}: {STEPS[step].replace('&', 'and')}</h2>
      {step === 0 && <PersonalFields profile={profile} onChange={changeProfile} />}
      {step === 1 && <EmploymentFields profile={profile} onChange={changeProfile} />}
      {step === 2 && <PreferenceFields profile={profile} onChange={changeProfile} />}
      {step === LAST && <>
        <div className="notice"><Check size={18} /><span>
          {reviewed
            ? 'Changes apply to future applications. Applications already started keep their original resume.'
            : 'Your answers are ready. Check the extracted experience, education, and skills before confirming.'}
        </span></div>
        <div className="surface editor-section setup-panel">
          <div className="eyebrow">04 · YOUR REVIEWED PROFILE</div>
          <h2>The facts behind every answer.</h2>
          <p>Open any section to correct the resume extraction. No experience or qualifications are added for you.</p>
          <label>Resume name<input value={profileName} onChange={(e) => { setSaved(false); setName(e.target.value) }} required maxLength={100} /></label>
        </div>
        {reviewSections.map((key, i) => (
          <details className="surface editor-section" key={key} open={key === 'experience' || undefined}>
            <summary><span className="section-number">{String(i + 1).padStart(2, '0')}</span>{label(key)}<span className="subtle">Edit details</span></summary>
            <Fields value={{ [key]: profile[key] as Value }}
              onChange={(next) => changeProfile({ ...profile, [key]: next[key] })} />
          </details>
        ))}
      </>}
      <div className="editor-save">
        <div>
          {error && <p role="alert" className="inline-error">{error}</p>}
          {saved && <p role="status">Your profile is saved.</p>}
          <p className="subtle">{step < LAST ? 'Continue saves your progress. You can edit these answers later.' : 'Confirm only the information you’re happy to use in applications.'}</p>
        </div>
        <div className="setup-actions">
          {step > 0 && <button type="button" className="button secondary" disabled={pending} onClick={() => goTo(step - 1)}>Back</button>}
          <button className="button primary" disabled={pending}>
            {pending ? 'Saving…' : step < LAST ? `Continue to ${STEPS[step + 1].toLowerCase()}` : reviewed ? 'Save changes' : 'Confirm profile & discover jobs'}
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </form>
  )
}
