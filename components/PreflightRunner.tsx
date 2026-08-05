'use client'

import { useState, useTransition } from 'react'
import { runPreflightAction } from '@/app/learn/actions'
import type { CheckResult } from '@/lib/doctor-checks'
import { btn } from './ui'

const ICONS: Record<CheckResult['status'], { glyph: string; className: string }> = {
  pass: { glyph: '✓', className: 'text-success-deep' },
  fail: { glyph: '✗', className: 'text-danger-deep' },
  warn: { glyph: '!', className: 'text-warning-deep' },
  info: { glyph: 'i', className: 'text-ink-500' }
}

/**
 * Runs the doctor's network checks from the browser via a server action.
 * Proves the tunnel round-trip BEFORE a create quota gets spent finding out.
 */
export function PreflightRunner() {
  const [results, setResults] = useState<CheckResult[] | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          className={btn('secondary', 'sm')}
          onClick={() =>
            startTransition(async () => {
              setResults(await runPreflightAction())
            })
          }
        >
          {pending ? 'Checking…' : results ? 'Run preflight again' : 'Run preflight'}
        </button>
        <span className="text-xs text-ink-600">
          DNS, tunnel round-trip, clock skew, and both API keys. Same checks as{' '}
          <code className="code-chip">npm run doctor</code>.
        </span>
      </div>

      {results && (
        <ul className="mt-4 divide-y hairline border hairline">
          {results.map((result) => {
            const icon = ICONS[result.status]
            return (
              <li key={result.name} className="flex items-baseline gap-3 px-4 py-2.5 text-sm">
                <span className={`w-3 shrink-0 font-mono ${icon.className}`}>{icon.glyph}</span>
                <span className="shrink-0 font-medium text-ink-800">{result.name}</span>
                <span className="min-w-0 text-ink-600">{result.detail}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
