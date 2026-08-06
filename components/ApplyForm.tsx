'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createApplicationAction } from '@/app/actions/applications'
import type { SandboxScenario } from '@/lib/jobo/sandbox'
import { btn } from './ui'

interface Props {
  profiles: { id: string; name: string; isDefault: boolean }[]
  scenarios: SandboxScenario[]
  sandboxAvailable: boolean
  sandboxNote: string | null
  defaultSandbox: boolean
  callbackUrl: string
  /** Where to go after a successful create; the new id is appended. */
  redirectPrefix?: string
  /** Notebook mode: label the submit "Run" with a play glyph. */
  runButton?: boolean
}

export function ApplyForm({
  profiles,
  scenarios,
  sandboxAvailable,
  sandboxNote,
  defaultSandbox,
  callbackUrl,
  redirectPrefix = '/applications/',
  runButton = false
}: Props) {
  const router = useRouter()
  const [profileId, setProfileId] = useState(
    profiles.find((p) => p.isDefault)?.id ?? profiles[0]?.id ?? ''
  )
  const [sandbox, setSandbox] = useState(defaultSandbox && sandboxAvailable)
  const [scenarioSlug, setScenarioSlug] = useState(scenarios[0]?.slug ?? '')
  const [applyUrl, setApplyUrl] = useState('')
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const scenario = scenarios.find((s) => s.slug === scenarioSlug)
  const effectiveUrl = sandbox ? (scenario?.apply_url ?? '') : applyUrl
  const canSubmit = Boolean(profileId && effectiveUrl) && !pending

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        startTransition(async () => {
          const result = await createApplicationAction({
            profileId,
            applyUrl: effectiveUrl,
            sandbox,
            scenarioSlug: sandbox ? scenarioSlug : undefined
          })
          if (result.ok) router.push(`${redirectPrefix}${result.id}`)
          else setError({ message: result.error, code: result.code })
        })
      }}
      className="space-y-4"
    >
      <label className="block text-sm">
        <span className="font-medium text-ink-800">Profile</span>
        <select
          value={profileId}
          onChange={(event) => setProfileId(event.target.value)}
          className="field mt-1.5"
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={sandbox}
          disabled={!sandboxAvailable}
          onChange={(event) => setSandbox(event.target.checked)}
          className="mt-1 h-4 w-4 accent-[#8a05ff]"
        />
        <span>
          <span className="font-medium text-ink-800">Sandbox</span>
          <span className="block text-xs text-ink-600">
            Runs against Jobo&apos;s own fake ATS instead of a real employer. Start here.
            {!sandboxAvailable && sandboxNote && ` — ${sandboxNote}`}
          </span>
        </span>
      </label>

      {sandbox ? (
        <label className="block text-sm">
          <span className="font-medium text-ink-800">Scenario</span>
          <select
            value={scenarioSlug}
            onChange={(event) => setScenarioSlug(event.target.value)}
            className="field mt-1.5"
          >
            {scenarios.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
          {scenario?.description && (
            <span className="mt-1 block text-xs text-ink-600">{scenario.description}</span>
          )}
        </label>
      ) : (
        <label className="block text-sm">
          <span className="font-medium text-ink-800">Job application URL</span>
          <input
            type="url"
            value={applyUrl}
            onChange={(event) => setApplyUrl(event.target.value)}
            placeholder="https://boards.greenhouse.io/acme/jobs/1234567"
            className="field mt-1.5"
          />
          <span className="mt-1 block text-xs text-ink-600">
            The page with the application form. Jobo matches it to an ATS provider — if none
            matches you get <code className="font-mono">unsupported_ats</code>.
          </span>
        </label>
      )}

      {/* Shown so a stale tunnel hostname is visible BEFORE spending a create
          quota, rather than surfacing 30 seconds later as callback_unavailable. */}
      <div className="border hairline bg-ink-50 px-3 py-2 text-xs">
        <span className="font-mono uppercase tracking-[0.05em] text-ink-500">Callback URL</span>
        <code className="ml-2 break-all font-mono text-ink-800">{callbackUrl}</code>
      </div>

      {error && (
        <div className="bg-danger-tint px-3 py-2 text-sm text-danger-deep">
          {error.code && <code className="mr-2 font-mono text-xs">{error.code}</code>}
          {error.message}
        </div>
      )}

      <button type="submit" disabled={!canSubmit} className={btn('primary')}>
        {runButton ? (
          pending ? (
            'Running…'
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-3 w-3">
                <path d="M8 5v14l11-7z" />
              </svg>
              Run
            </>
          )
        ) : pending ? (
          'Creating…'
        ) : (
          'Create application'
        )}
      </button>
    </form>
  )
}
