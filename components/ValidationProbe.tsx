'use client'

import { useState, useTransition } from 'react'
import { probeValidationAction, type ProbeResult } from '@/app/learn/actions'
import { Badge, Json, btn } from './ui'

/**
 * Cell 2's Run button and output: fire one deliberately bad answer at the live
 * step and render the free per-field 400 that comes back. Client state only —
 * the exchange consumes nothing server-side, so there is nothing to persist.
 */
export function ValidationProbe({ id }: { id: string }) {
  const [result, setResult] = useState<ProbeResult | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div className="space-y-4">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            setResult(await probeValidationAction(id))
          })
        }}
        className={btn('primary')}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-3 w-3">
          <path d="M8 5v14l11-7z" />
        </svg>
        {pending ? 'Submitting a bad answer…' : 'Send a deliberately bad answer'}
      </button>

      {result && !result.ok && (
        <p className="bg-warning-tint px-3 py-2 text-sm text-warning-deep">{result.reason}</p>
      )}

      {result?.ok && (
        <div className="space-y-4">
          <div>
            <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.05em] text-ink-500">
              Sent · a {typeof result.sent.value} to &quot;{result.fieldLabel}&quot; ({result.fieldType})
            </p>
            <Json value={{ answers: [result.sent] }} />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-ink-500">
                Response · HTTP 400, per-field errors
              </p>
              <span className="text-xs tabular-nums text-ink-500">
                {(result.elapsedMs / 1000).toFixed(1)}s
              </span>
            </div>
            <div className="mb-2">
              <Badge tone="good" dot>
                free — nothing consumed
              </Badge>
            </div>
            <Json value={{ errors: result.errors }} />
          </div>

          <p className="bg-success-tint px-3 py-2 text-sm text-success-deep">
            The step is still open and no correction round was burned. Under the old
            webhook flow this exact mistake cost one of only three rounds — now the fix is to
            correct the value and submit again, which is precisely what the answer engine&apos;s
            repair pass does automatically in cell 3.
          </p>
        </div>
      )}
    </div>
  )
}
