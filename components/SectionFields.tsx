'use client'
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { degreeOptions, jobTypeOptions, skillYearsOptions } from '@/lib/resume/profile-schema'

export type Value = string | number | boolean | null | Value[] | { [key: string]: Value }
type RecordValue = { [key: string]: Value }
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
/** A blank entry for each list the editor can add to. */
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
const MONTHS = Array.from(
  { length: 12 },
  (_, i) =>
    [
      String(i + 1),
      new Date(Date.UTC(2000, i, 1)).toLocaleString('en', { month: 'long', timeZone: 'UTC' }),
    ] as const,
)
/** Select fields, with whether "Not specified" is allowed. */
const enums: Record<
  string,
  { options: readonly (readonly [string, string])[]; nullable: boolean }
> = {
  degree: { options: degreeOptions, nullable: false },
  type: { options: jobTypeOptions, nullable: true },
  years: { options: skillYearsOptions, nullable: true },
}
export const label = (key: string) =>
  titles[key] ?? key.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase())
const booleans = new Set(['currently_working', 'favorite'])
const isNumber = (key: string) => key === 'gpa' || key.endsWith('_year')
const longText = new Set(['description'])
/**
 * A generic editor for a JSON object: one input per key, chosen by the key's
 * name and value (checkbox, select, number, text, textarea), recursing into
 * nested objects and lists. Used for the resume sections, whose shape comes
 * from lib/resume/profile-schema.ts.
 */
export function SectionFields({
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
            return <ArraySection key={key} name={key} items={v} onChange={change} />
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
          return <SectionFields key={key} value={v} onChange={change} />
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
              <textarea rows={4} value={String(v ?? '')} onChange={(e) => change(e.target.value)} />
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

let nextKey = 0

/**
 * A list of entries (jobs, schools, …) with add and remove. Entries have no
 * ids of their own, so the section keeps a parallel list of React keys:
 * removing an entry keeps every other entry's inputs (and focus) in place.
 */
function ArraySection({
  name,
  items,
  onChange,
}: {
  name: string
  items: Value[]
  onChange: (next: Value[]) => void
}) {
  // Index-based on first render, so server and client agree.
  const [keys, setKeys] = useState(() => items.map((_, i) => `initial-${i}`))
  const rowKeys = items.map((_, i) => keys[i] ?? `extra-${i}`)
  return (
    <div className="array-section">
      {items.map((item, i) => (
        <div className="array-item" key={rowKeys[i]}>
          <div className="spread">
            <strong>
              {label(name)} {i + 1}
            </strong>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove ${label(name)} ${i + 1}`}
              onClick={() => {
                setKeys(rowKeys.filter((_, n) => n !== i))
                onChange(items.filter((_, n) => n !== i))
              }}
            >
              <Trash2 size={15} />
            </button>
          </div>
          <SectionFields
            value={item as RecordValue}
            onChange={(next) => onChange(items.map((old, n) => (n === i ? next : old)))}
          />
        </div>
      ))}
      <button
        className="button secondary small"
        type="button"
        onClick={() => {
          setKeys([...rowKeys, `added-${nextKey++}`])
          onChange([...items, { ...templates[name] }])
        }}
      >
        <Plus size={15} />
        Add {label(name).toLowerCase()}
      </button>
    </div>
  )
}
