'use client'

import { Check, ShieldCheck } from 'lucide-react'
import {
  ethnicityOptions,
  genderOptions,
  jobTypeOptions,
  workSetupOptions,
  yesNoDeclineOptions,
  type Ethnicity,
  type ResumeProfile,
} from '@/lib/resume/profile-schema'
import { contactIssues, employmentIssues } from '@/lib/resume/completeness'

type Props = { profile: ResumeProfile; onChange: (profile: ResumeProfile) => void }
type Options = readonly (readonly [string, string])[]

const NOT_ANSWERED = ''

function Choice({
  label,
  value,
  options,
  onChange,
  missing,
  help,
}: {
  label: string
  value: string | null
  options: Options
  onChange: (value: string | null) => void
  missing?: boolean
  help?: string
}) {
  return (
    <label>
      {label}
      <select
        value={value ?? NOT_ANSWERED}
        data-missing={missing || undefined}
        onChange={(e) => onChange(e.target.value === NOT_ANSWERED ? null : e.target.value)}
      >
        <option value={NOT_ANSWERED}>Not answered</option>
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
      {help && <small>{help}</small>}
    </label>
  )
}

const yesNo = [
  ['true', 'Yes'],
  ['false', 'No'],
] as const
const fromBool = (value: boolean | null) => (value === null ? null : String(value))
const toBool = (value: string | null) => (value === null ? null : value === 'true')

function Checkboxes<T extends string>({
  legend,
  options,
  selected,
  onChange,
  exclusive,
}: {
  legend: string
  options: readonly (readonly [T, string])[]
  selected: readonly T[]
  onChange: (next: T[]) => void
  /** An option that clears the others, and is cleared by them. */
  exclusive?: T
}) {
  return (
    <fieldset className="choice-group wide-field">
      <legend>{legend}</legend>
      {options.map(([key, text]) => (
        <label key={key} className="choice">
          <input
            type="checkbox"
            checked={selected.includes(key)}
            onChange={(e) => {
              if (!e.target.checked) return onChange(selected.filter((v) => v !== key))
              if (key === exclusive) return onChange([key])
              onChange([...selected.filter((v) => v !== exclusive), key])
            }}
          />
          {text}
        </label>
      ))}
    </fieldset>
  )
}

function countryName(code: string | null): string | null {
  if (!code || !/^[A-Z]{2}$/.test(code)) return null
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? null
  } catch {
    return null
  }
}

export function PersonalFields({ profile, onChange }: Props) {
  const issues = contactIssues(profile)
  const missing = Object.values(issues).filter(Boolean).length
  const personal = (patch: Partial<ResumeProfile['personal']>) =>
    onChange({ ...profile, personal: { ...profile.personal, ...patch } })
  const location = (patch: Partial<ResumeProfile['location']>) =>
    onChange({ ...profile, location: { ...profile.location, ...patch } })
  const link = (key: keyof ResumeProfile['links'], value: string) =>
    onChange({ ...profile, links: { ...profile.links, [key]: value || null } })
  const text = (value: string) => value || null
  return (
    <section className="surface editor-section setup-panel" aria-labelledby="personal-heading">
      <div className="setup-panel-heading">
        <div>
          <div className="eyebrow">01 · PERSONAL INFO</div>
          <h2 id="personal-heading">Fill the gaps. Keep it yours.</h2>
        </div>
        <span className={`setup-count ${missing ? '' : 'complete'}`} aria-live="polite">
          {missing ? (
            `${missing} to complete`
          ) : (
            <>
              <Check size={15} /> All set
            </>
          )}
        </span>
      </div>
      <p>
        We’ve filled in what we found in your resume. Name, email, phone and LinkedIn are required
        to try Auto Apply; the rest answers the address and link questions forms ask.
      </p>
      <div className="editor-fields">
        <label>
          First name <span className="field-requirement">Required</span>
          <input
            name="first_name"
            autoComplete="given-name"
            required
            value={profile.personal.first_name}
            data-missing={!profile.personal.first_name.trim()}
            onChange={(e) => personal({ first_name: e.target.value })}
          />
        </label>
        <label>
          Last name <span className="field-requirement">Required</span>
          <input
            name="last_name"
            autoComplete="family-name"
            required
            value={profile.personal.last_name}
            data-missing={!profile.personal.last_name.trim()}
            onChange={(e) => personal({ last_name: e.target.value })}
          />
        </label>
        <label>
          Preferred first name
          <input
            name="preferred_name"
            autoComplete="nickname"
            value={profile.personal.preferred_name ?? ''}
            onChange={(e) => personal({ preferred_name: text(e.target.value) })}
          />
        </label>
        <label>
          Date of birth
          <input
            name="birthday"
            type="date"
            autoComplete="bday"
            value={profile.personal.birthday ?? ''}
            onChange={(e) => personal({ birthday: text(e.target.value) })}
            aria-describedby="birthday-help"
          />
          <small id="birthday-help">
            Only used for date-of-birth and “are you over 18” questions.
          </small>
        </label>
        <label>
          Email address <span className="field-requirement">Required</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            value={profile.personal.email}
            data-missing={!!issues.email}
            onChange={(e) => personal({ email: e.target.value })}
          />
        </label>
        <label>
          Phone number <span className="field-requirement">Required</span>
          <input
            name="phone"
            type="tel"
            autoComplete="tel"
            required
            placeholder="+1 415 555 0123"
            value={profile.personal.phone ?? ''}
            data-missing={!!issues.phone}
            onChange={(e) => personal({ phone: e.target.value })}
            aria-describedby="phone-help"
          />
          <small id="phone-help">Include the country code so forms can use it correctly.</small>
        </label>
        <label className="wide-field">
          Street address
          <input
            autoComplete="address-line1"
            value={profile.location.address ?? ''}
            onChange={(e) => location({ address: text(e.target.value) })}
          />
        </label>
        <label>
          Address line 2
          <input
            autoComplete="address-line2"
            value={profile.location.address_2 ?? ''}
            onChange={(e) => location({ address_2: text(e.target.value) })}
          />
        </label>
        <label>
          Address line 3
          <input
            autoComplete="address-line3"
            value={profile.location.address_3 ?? ''}
            onChange={(e) => location({ address_3: text(e.target.value) })}
          />
        </label>
        <label>
          City
          <input
            autoComplete="address-level2"
            placeholder="e.g. Amsterdam"
            value={profile.location.city ?? ''}
            onChange={(e) => location({ city: text(e.target.value) })}
          />
        </label>
        <label>
          State / province
          <input
            autoComplete="address-level1"
            value={profile.location.region ?? ''}
            onChange={(e) => location({ region: text(e.target.value) })}
          />
        </label>
        <label>
          Postal code
          <input
            autoComplete="postal-code"
            value={profile.location.postal_code ?? ''}
            onChange={(e) => location({ postal_code: text(e.target.value) })}
          />
        </label>
        <label>
          Country code
          <input
            autoComplete="country"
            maxLength={2}
            pattern="[A-Za-z]{2}"
            placeholder="e.g. NL, US, GB"
            value={profile.location.country_code ?? ''}
            onChange={(e) => {
              const code = e.target.value.toUpperCase()
              location({ country_code: text(code), country_name: countryName(code) })
            }}
          />
        </label>
        <label>
          LinkedIn profile <span className="field-requirement">Required</span>
          <input
            name="linkedin"
            type="url"
            required
            placeholder="https://www.linkedin.com/in/your-name"
            value={profile.links.linkedin ?? ''}
            data-missing={!!issues.linkedin}
            aria-describedby="linkedin-help"
            onChange={(e) => link('linkedin', e.target.value)}
          />
          <small id="linkedin-help">
            Use your personal LinkedIn profile, starting with https://.
          </small>
        </label>
        <label>
          GitHub
          <input
            type="url"
            placeholder="https://github.com/you"
            value={profile.links.github ?? ''}
            onChange={(e) => link('github', e.target.value)}
          />
        </label>
        <label>
          Portfolio
          <input
            type="url"
            placeholder="https://"
            value={profile.links.portfolio ?? ''}
            onChange={(e) => link('portfolio', e.target.value)}
          />
        </label>
        <label>
          Other URL
          <input
            type="url"
            placeholder="https://"
            value={profile.links.other ?? ''}
            onChange={(e) => link('other', e.target.value)}
          />
        </label>
      </div>
    </section>
  )
}

export function EmploymentFields({ profile, onChange }: Props) {
  const issues = employmentIssues(profile)
  const missing = Object.values(issues).filter(Boolean).length
  const auth = profile.work_authorization
  const authorization = (patch: Partial<ResumeProfile['work_authorization']>) =>
    onChange({ ...profile, work_authorization: { ...auth, ...patch } })
  const eeo = (patch: Partial<ResumeProfile['eeo']>) =>
    onChange({ ...profile, eeo: { ...profile.eeo, ...patch } })
  return (
    <>
      <section
        className="surface editor-section setup-panel"
        aria-labelledby="authorization-heading"
      >
        <div className="setup-panel-heading">
          <div>
            <div className="eyebrow">02 · EMPLOYMENT INFO</div>
            <h2 id="authorization-heading">Where you can work.</h2>
          </div>
          <span className={`setup-count ${missing ? '' : 'complete'}`} aria-live="polite">
            {missing ? (
              `${missing} to complete`
            ) : (
              <>
                <Check size={15} /> All set
              </>
            )}
          </span>
        </div>
        <p>
          Work authorization is answered only from what you say here, never guessed. If a job asks
          about a country you haven’t covered, the demo stops and explains why.
        </p>
        <div className="editor-fields">
          <Choice
            label="Are you authorized to work in the US?"
            value={fromBool(auth.us)}
            options={yesNo}
            missing={auth.us === null}
            onChange={(v) => authorization({ us: toBool(v) })}
          />
          <Choice
            label="Are you authorized to work in Canada?"
            value={fromBool(auth.canada)}
            options={yesNo}
            missing={auth.canada === null}
            onChange={(v) => authorization({ canada: toBool(v) })}
          />
          <Choice
            label="Are you authorized to work in the United Kingdom?"
            value={fromBool(auth.uk)}
            options={yesNo}
            missing={auth.uk === null}
            onChange={(v) => authorization({ uk: toBool(v) })}
          />
          <label>
            Also authorized to work in
            <input
              placeholder="e.g. NL, DE"
              defaultValue={auth.other_country_codes.join(', ')}
              pattern="[A-Za-z]{2}([, ]+[A-Za-z]{2})*"
              aria-describedby="other-countries-help"
              onChange={(e) =>
                authorization({
                  other_country_codes: e.target.value
                    .toUpperCase()
                    .split(/[,\s]+/)
                    .filter(Boolean),
                })
              }
            />
            <small id="other-countries-help">
              Country codes, comma separated. Any EU code also answers “authorized to work in the
              EU”.
            </small>
          </label>
          <Choice
            label="Will you now or in the future require sponsorship for employment visa status?"
            value={fromBool(auth.requires_sponsorship)}
            options={yesNo}
            missing={auth.requires_sponsorship === null}
            onChange={(v) => authorization({ requires_sponsorship: toBool(v) })}
          />
        </div>
      </section>
      <section
        className="surface editor-section setup-panel eeo-panel"
        aria-labelledby="eeo-heading"
      >
        <div className="setup-panel-heading">
          <h2 id="eeo-heading">
            <ShieldCheck size={21} /> Equal employment info
          </h2>
          <span className="tag">Voluntary</span>
        </div>
        <p>
          US employers ask these questions to measure the fairness of their hiring. Answering is
          voluntary and never affects an application. “Decline to state” is always an option.
        </p>
        <div className="editor-fields">
          <Choice
            label="Gender"
            value={profile.eeo.gender}
            options={genderOptions}
            missing={!!issues.gender}
            onChange={(v) => eeo({ gender: v as ResumeProfile['eeo']['gender'] })}
            help="Pronoun questions use this too: He/him, She/her or They/them."
          />
          <Choice
            label="Are you a veteran?"
            value={profile.eeo.veteran}
            options={yesNoDeclineOptions}
            missing={!!issues.veteran}
            onChange={(v) => eeo({ veteran: v as ResumeProfile['eeo']['veteran'] })}
          />
          <Choice
            label="Do you have a disability?"
            value={profile.eeo.disability}
            options={yesNoDeclineOptions}
            missing={!!issues.disability}
            onChange={(v) => eeo({ disability: v as ResumeProfile['eeo']['disability'] })}
          />
          <Choice
            label="Do you identify as LGBTQ+?"
            value={profile.eeo.lgbtq}
            options={yesNoDeclineOptions}
            missing={!!issues.lgbtq}
            onChange={(v) => eeo({ lgbtq: v as ResumeProfile['eeo']['lgbtq'] })}
          />
          <Checkboxes<Ethnicity>
            legend="Ethnicity (select all that apply)"
            options={ethnicityOptions}
            selected={profile.eeo.ethnicity ?? []}
            exclusive="decline"
            onChange={(next) => eeo({ ethnicity: next.length ? next : null })}
          />
        </div>
        <small>
          These answers are matched to each form’s own options by fixed rules and are never sent to
          the answer model. If a form’s options don’t fit your answer exactly, its “prefer not to
          say” option is used instead.
        </small>
      </section>
    </>
  )
}

export function PreferenceFields({ profile, onChange }: Props) {
  const preferences = (patch: Partial<ResumeProfile['preferences']>) =>
    onChange({ ...profile, preferences: { ...profile.preferences, ...patch } })
  return (
    <section className="surface editor-section setup-panel" aria-labelledby="preferences-heading">
      <div className="eyebrow">03 · JOB PREFERENCES</div>
      <h2 id="preferences-heading">What you’re looking for.</h2>
      <p>
        Optional. Used when a form asks about job type, work setup, location or salary expectations.
      </p>
      <div className="editor-fields">
        <Checkboxes
          legend="Job types"
          options={jobTypeOptions}
          selected={profile.preferences.job_types}
          onChange={(job_types) => preferences({ job_types })}
        />
        <Checkboxes
          legend="Work setup"
          options={workSetupOptions}
          selected={profile.preferences.work_setups}
          onChange={(work_setups) => preferences({ work_setups })}
        />
        <label>
          Preferred locations
          <input
            placeholder="e.g. Amsterdam, London, Remote (EU)"
            defaultValue={profile.preferences.locations.join(', ')}
            onChange={(e) =>
              preferences({
                locations: e.target.value
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean),
              })
            }
          />
          <small>Comma separated.</small>
        </label>
        <label>
          Minimum expected salary (yearly)
          <input
            type="number"
            min={0}
            step={1000}
            placeholder="e.g. 90000"
            value={profile.preferences.min_salary ?? ''}
            onChange={(e) =>
              preferences({ min_salary: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
        </label>
      </div>
    </section>
  )
}
