'use client'
import { useRef, useState } from 'react'
import { pushWithFallback, useBusy } from '@/lib/use-busy'
import { useRouter } from 'next/navigation'
import { Check, ArrowRight } from 'lucide-react'
import type { ResumeProfile } from '@/lib/resume/profile-schema'
import { SectionFields, label, type Value } from './SectionFields'
import { EmploymentFields, PersonalFields, PreferenceFields } from './ProfileSetupFields'
import { contactIssues, employmentIssues } from '@/lib/resume/completeness'
import { updateProfileAction } from '@/app/actions/profiles'
/** The resume-backed sections, edited in the review step. */
const reviewSections = ['experience', 'education', 'projects', 'skills', 'languages'] as const
const STEPS = ['Personal info', 'Employment info', 'Job preferences', 'Review & confirm']
const LAST = STEPS.length - 1

/**
 * The four-step profile review: personal info, employment info (work
 * authorization and self-identification), job preferences, then the resume
 * sections. Saves through updateProfileAction; confirming marks the profile
 * reviewed, which is what allows applying with it.
 */
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
  const changeProfile = (next: ResumeProfile) => {
    setSaved(false)
    setError('')
    setProfile(next)
  }
  const goTo = (next: number) => {
    setStep(next)
    setError('')
    requestAnimationFrame(() => stepHeading.current?.focus())
  }
  const contactMissing = Object.values(contactIssues(profile)).filter(Boolean)
  const employmentMissing = Object.values(employmentIssues(profile)).filter(Boolean)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        // Each gate sends you back to the step that owns the missing answers.
        const gate =
          (step === 0 || step === LAST) && contactMissing.length
            ? { at: 0, missing: contactMissing }
            : (step === 1 || step === LAST) && employmentMissing.length
              ? { at: 1, missing: employmentMissing }
              : null
        if (gate) {
          setStep(gate.at)
          setError(gate.missing.join(' '))
          requestAnimationFrame(() =>
            document.querySelector<HTMLElement>('[data-missing="true"]')?.focus(),
          )
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
      }}
    >
      <ol className="profile-steps" aria-label="Profile setup progress">
        {STEPS.map((title, index) => (
          <li
            key={title}
            aria-current={step === index ? 'step' : undefined}
            data-complete={step > index}
          >
            <span>{step > index ? <Check size={15} /> : `0${index + 1}`}</span>
            {title}
          </li>
        ))}
      </ol>
      <h2 className="sr-only" tabIndex={-1} ref={stepHeading}>
        Step {step + 1}: {STEPS[step].replace('&', 'and')}
      </h2>
      {step === 0 && <PersonalFields profile={profile} onChange={changeProfile} />}
      {step === 1 && <EmploymentFields profile={profile} onChange={changeProfile} />}
      {step === 2 && <PreferenceFields profile={profile} onChange={changeProfile} />}
      {step === LAST && (
        <>
          <div className="notice">
            <Check size={18} />
            <span>
              {reviewed
                ? 'Changes apply to future applications. Applications already started keep their original resume.'
                : 'Your answers are ready. Check the extracted experience, education, and skills before confirming.'}
            </span>
          </div>
          <div className="surface editor-section setup-panel">
            <div className="eyebrow">04 · YOUR REVIEWED PROFILE</div>
            <h2>The facts behind every answer.</h2>
            <p>
              Open any section to correct the resume extraction. No experience or qualifications are
              added for you.
            </p>
            <label>
              Resume name
              <input
                value={profileName}
                onChange={(e) => {
                  setSaved(false)
                  setName(e.target.value)
                }}
                required
                maxLength={100}
              />
            </label>
          </div>
          {reviewSections.map((key, i) => (
            <details
              className="surface editor-section"
              key={key}
              open={key === 'experience' || undefined}
            >
              <summary>
                <span className="section-number">{String(i + 1).padStart(2, '0')}</span>
                {label(key)}
                <span className="subtle">Edit details</span>
              </summary>
              <SectionFields
                value={{ [key]: profile[key] as Value }}
                onChange={(next) => changeProfile({ ...profile, [key]: next[key] })}
              />
            </details>
          ))}
        </>
      )}
      <div className="editor-save">
        <div>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          {saved && <p role="status">Your profile is saved.</p>}
          <p className="subtle">
            {step < LAST
              ? 'Continue saves your progress. You can edit these answers later.'
              : 'Confirm only the information you’re happy to use in applications.'}
          </p>
        </div>
        <div className="setup-actions">
          {step > 0 && (
            <button
              type="button"
              className="button secondary"
              disabled={pending}
              onClick={() => goTo(step - 1)}
            >
              Back
            </button>
          )}
          <button className="button primary" disabled={pending}>
            {pending
              ? 'Saving…'
              : step < LAST
                ? `Continue to ${STEPS[step + 1].toLowerCase()}`
                : reviewed
                  ? 'Save changes'
                  : 'Confirm profile & discover jobs'}
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </form>
  )
}
