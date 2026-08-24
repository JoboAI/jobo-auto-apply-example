import type { StepRow } from '@/db/schema'
import { Badge, Json, relativeTime } from './ui'
import { TraceTable } from './TraceTable'

/**
 * The step log — a request bin for the one exchange that matters.
 *
 * One card per answer exchange: a step at a given correction round, with the
 * exact fields Jobo handed over and the exact answer snapshot this app
 * submitted, plus the per-field provenance trace. It outlives the data
 * upstream — Jobo purges sandbox applications after 24 hours — which is why
 * the steps table stores the bodies rather than a summary.
 */

const STATUS_META: Record<string, { label: string; tone: 'neutral' | 'good' | 'warn' | 'bad' }> = {
  answering: { label: 'answering', tone: 'neutral' },
  submitted: { label: 'answers accepted', tone: 'good' },
  canceled: { label: 'canceled', tone: 'warn' },
  error: { label: 'error', tone: 'bad' }
}

function StepCard({ step }: { step: StepRow }) {
  const meta = STATUS_META[step.status] ?? { label: step.status, tone: 'neutral' as const }
  const commandErrors = step.commandErrorsJson ?? []

  return (
    <details className="panel" open>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm">
        <code className="font-mono text-[13px] font-medium text-ink-900">
          step {step.sequence}
        </code>
        {step.correctionRound > 0 && (
          <Badge tone="warn">correction round {step.correctionRound}</Badge>
        )}
        <Badge tone={meta.tone} dot>
          {meta.label}
        </Badge>
        <span className="ml-auto text-xs tabular-nums text-ink-500">
          {step.totalMs !== null ? `${(step.totalMs / 1000).toFixed(1)}s · ` : ''}
          {relativeTime(step.receivedAt)}
        </span>
      </summary>

      <div className="space-y-4 border-t hairline px-4 py-4">
        {/* The step id: stable across correction rounds, and what you grep for
            on both sides of the API. */}
        <p className="font-mono text-[11px] text-ink-500">{step.stepId}</p>

        {step.error && (
          <p className="bg-warning-tint px-3 py-2 text-xs text-warning-deep">{step.error}</p>
        )}

        {/* Kept above the bodies on purpose: this is why the previous round was
            rejected by the employer's ATS, and it is not derivable from the
            fields alone. */}
        {commandErrors.length > 0 && (
          <div>
            <h4 className="font-mono text-[11px] uppercase tracking-[0.05em] text-ink-500">
              The ATS rejected the previous answers ({commandErrors.length})
            </h4>
            <ul className="mt-1.5 space-y-1 text-xs">
              {commandErrors.map((error, index) => (
                <li key={index}>
                  <code className="font-mono text-danger-deep">{error.code}</code>{' '}
                  <span className="text-ink-600">
                    {error.field_id}
                    {error.field_key ? `.${error.field_key}` : ''} — {error.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.05em] text-ink-500">
            Fields · what Jobo discovered
          </p>
          <div className="max-h-96 overflow-y-auto">
            {step.fieldsJson ? (
              <Json value={step.fieldsJson} />
            ) : (
              <p className="text-xs text-ink-500">No fields recorded.</p>
            )}
          </div>
        </div>

        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.05em] text-ink-500">
            Answers · what we submitted
          </p>
          <div className="max-h-96 overflow-y-auto">
            {step.answersJson ? (
              <Json value={step.answersJson} />
            ) : (
              <p className="text-xs text-ink-500">No answers submitted for this round.</p>
            )}
          </div>
        </div>

        {step.trace && step.trace.length > 0 && (
          <div>
            <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.05em] text-ink-500">
              How each field was answered
            </p>
            <TraceTable trace={step.trace} />
          </div>
        )}
      </div>
    </details>
  )
}

export function StepLog({ steps }: { steps: StepRow[] }) {
  if (steps.length === 0) {
    return (
      <p className="text-sm text-ink-600">
        Steps not received yet. The blocking create resolves once Jobo&apos;s browser session has
        opened the page and found the form — typically within a minute or two.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {steps.map((step) => (
        <StepCard key={`${step.stepId}:${step.correctionRound}`} step={step} />
      ))}
    </div>
  )
}
