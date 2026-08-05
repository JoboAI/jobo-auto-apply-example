import type { WebhookEventRow } from '@/db/schema'
import type { AnswerCommand, Field, FieldsRequestedEvent } from '@jobo-ai/autoapply'
import type { AnswerTrace } from '@/lib/answers/types'
import { Badge, Json, relativeTime } from './ui'

/**
 * The callback log.
 *
 * This is why `webhook_events` stores `raw_body` and `response_body` verbatim
 * rather than a summary: being able to see the exact fields Jobo sent, the
 * exact answers we returned, and *why each answer was chosen* is the
 * difference between debugging this integration and guessing at it. It also
 * outlives the data upstream — Jobo purges sandbox applications after 24h.
 */

/** The absolute callback deadline, from the event's created_at. */
const CALLBACK_DEADLINE_MS = 120_000

const SOURCE_TONE = {
  deterministic: 'good',
  llm: 'info',
  repaired: 'warn',
  previous_round: 'neutral',
  declined: 'neutral',
  dropped: 'bad'
} as const

const SOURCE_LABEL = {
  deterministic: 'rule',
  llm: 'AI',
  repaired: 'repaired',
  previous_round: 'carried over',
  declined: 'declined',
  dropped: 'dropped'
} as const

function preview(value: unknown): string {
  if (value === undefined) return '—'
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 120)}…` : value
  const json = JSON.stringify(value)
  return json && json.length > 120 ? `${json.slice(0, 120)}…` : (json ?? '—')
}


/**
 * Jobo discovers fields from the DOM, so a `select` or `multi_select` arrives
 * with its own option text folded into the label:
 *
 *   "Country ChooseVietnamUnited States"   options: [Vietnam, United States]
 *   "Preferred locations RemoteHo Chi Minh CityNew York"
 *
 * The options get their own column, so repeating them in the label reads as a
 * rendering bug. Peel them off the end, back to front, since they are
 * concatenated in order with no separator.
 *
 * The placeholder (`<option value="">Choose</option>`) is a special case: it
 * has no value, so Jobo drops it from `options` and this cannot match it. Trim
 * a trailing placeholder word only when options were actually removed — that
 * way a field genuinely called "Choose" is never touched.
 *
 * Presentation only. `field.label` is what the answer engine sees, and it is
 * left exactly as Jobo sent it.
 */
const SELECT_PLACEHOLDERS = ['Choose', 'Select', 'Select one', 'Please select', 'None', '--']

export function displayLabel(field: Field): string {
  const original = (field.label ?? '').trim()
  const options = field.options ?? []
  if (options.length === 0) return original

  let label = original
  let stripped = false
  for (let i = options.length - 1; i >= 0; i--) {
    const text = options[i]?.label?.trim()
    if (text && label.endsWith(text)) {
      label = label.slice(0, -text.length).trimEnd()
      stripped = true
    }
  }

  if (stripped) {
    for (const placeholder of SELECT_PLACEHOLDERS) {
      if (label.toLowerCase().endsWith(placeholder.toLowerCase())) {
        label = label.slice(0, -placeholder.length).trimEnd()
        break
      }
    }
  }

  // Never hand back an empty cell — a label that was nothing but options is
  // still more useful than blank.
  return label || original
}

function FieldTable({ fields }: { fields: Field[] }) {
  return (
    <div className="overflow-x-auto border hairline">
      <table className="s-table">
        <thead>
          <tr>
            <th>Label</th>
            <th>Type</th>
            <th>Required</th>
            <th>semantic_key</th>
            <th>Options</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.field_id}>
              <td className="text-ink-800">
                {displayLabel(field) || <code className="font-mono text-xs">{field.field_id}</code>}
                {field.sensitive && <span className="ml-1.5 text-xs text-ink-500">(sensitive)</span>}
              </td>
              <td>
                <code className="font-mono text-xs text-ink-600">{field.type}</code>
              </td>
              <td className="text-ink-600">{field.requires_answer ? 'yes' : '—'}</td>
              <td className="font-mono text-xs text-ink-500">{field.semantic_key ?? '—'}</td>
              <td className="text-ink-600">
                {field.options?.length ? (
                  <span className="text-xs">
                    {field.options.slice(0, 3).map((option) => option.label).join(', ')}
                    {field.options.length > 3 && ` +${field.options.length - 3}`}
                  </span>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TraceTable({ trace }: { trace: AnswerTrace[] }) {
  return (
    <ul className="divide-y hairline text-xs">
      {trace.map((entry, index) => (
        <li key={`${entry.field_id}-${index}`} className="py-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <Badge tone={SOURCE_TONE[entry.source] ?? 'neutral'}>
              {SOURCE_LABEL[entry.source] ?? entry.source}
            </Badge>
            <span className="font-medium text-ink-800">{entry.label}</span>
            <code className="font-mono text-ink-500">{entry.type}</code>
            {entry.confidence !== undefined && (
              <span className="tabular-nums text-ink-500">
                confidence {entry.confidence.toFixed(2)}
              </span>
            )}
          </div>
          {entry.value !== undefined && (
            <p className="mt-1 break-words text-ink-800">{preview(entry.value)}</p>
          )}
          {entry.rule && (
            <p className="mt-0.5 font-mono text-[11px] text-ink-500">rule: {entry.rule}</p>
          )}
          {entry.reasoning && <p className="mt-0.5 italic text-ink-600">{entry.reasoning}</p>}
          {entry.repaired_from !== undefined && (
            <p className="mt-0.5 text-ink-500">repaired from {preview(entry.repaired_from)}</p>
          )}
          {entry.reason && <p className="mt-0.5 text-ink-500">{entry.reason}</p>}
        </li>
      ))}
    </ul>
  )
}

/**
 * How much of the 120-second absolute window the answer actually used.
 * Making the deadline visceral is half the point of storing totalMs.
 */
function BudgetMeter({ totalMs }: { totalMs: number }) {
  const used = Math.min(totalMs / CALLBACK_DEADLINE_MS, 1)
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.05em] text-ink-500">
          Callback budget
        </span>
        <span className="text-xs tabular-nums text-ink-600">
          answered in {(totalMs / 1000).toFixed(1)}s of the 120s window
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full bg-ink-100">
        <div
          className="h-full bg-brand-bright"
          style={{ width: `${Math.max(used * 100, 1).toFixed(1)}%` }}
        />
      </div>
    </div>
  )
}

function EventCard({ event }: { event: WebhookEventRow }) {
  let parsed: FieldsRequestedEvent | null = null
  try {
    parsed = JSON.parse(event.rawBody) as FieldsRequestedEvent
  } catch {
    parsed = null
  }

  let command: AnswerCommand | null = null
  if (event.responseBody) {
    try {
      command = JSON.parse(event.responseBody) as AnswerCommand
    } catch {
      command = null
    }
  }

  const isFields = event.type === 'application.fields_requested'
  const fields = isFields ? (parsed?.step?.fields ?? []) : []
  const commandErrors = isFields ? (parsed?.step?.command_errors ?? []) : []

  return (
    <details className="panel" open={isFields}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm">
        {/* Every stored event got past signature verification — that is a
            precondition for reaching the handler at all. */}
        <Badge tone="good" dot>
          signature ok
        </Badge>
        <code className="font-mono text-[13px] font-medium text-ink-900">
          {event.type.replace('application.', '')}
        </code>
        {event.correctionRound !== null && event.correctionRound > 0 && (
          <Badge tone="warn">correction round {event.correctionRound}</Badge>
        )}
        {event.attemptsSeen > 1 && <Badge>seen {event.attemptsSeen}×</Badge>}
        <span className="ml-auto text-xs tabular-nums text-ink-500">
          {event.llmMs ? `AI ${event.llmMs}ms · ` : ''}
          {event.totalMs ? `total ${event.totalMs}ms · ` : ''}
          {relativeTime(event.receivedAt)}
        </span>
      </summary>

      <div className="space-y-4 border-t hairline px-4 py-4">
        <p className="font-mono text-[11px] text-ink-500">
          {event.id}
          {event.llmModel && <> · model {event.llmModel}</>}
        </p>

        {isFields && event.totalMs !== null && <BudgetMeter totalMs={event.totalMs} />}

        {event.error && (
          <p className="bg-warning-tint px-3 py-2 text-xs text-warning-deep">{event.error}</p>
        )}

        {commandErrors.length > 0 && (
          <div>
            <h4 className="font-mono text-[11px] uppercase tracking-[0.05em] text-ink-500">
              Jobo rejected the previous answers ({commandErrors.length})
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

        {fields.length > 0 && (
          <div>
            <h4 className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.05em] text-ink-500">
              Fields Jobo asked about ({fields.length})
            </h4>
            <FieldTable fields={fields} />
          </div>
        )}

        {event.trace && event.trace.length > 0 && (
          <div>
            <h4 className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.05em] text-ink-500">
              How each answer was produced ({event.trace.length})
            </h4>
            <TraceTable trace={event.trace} />
          </div>
        )}

        <details>
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.05em] text-ink-500">
            Raw request and response
          </summary>
          <div className="mt-2 grid gap-3 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-xs text-ink-500">Request body (exactly as signed)</p>
              <Json value={parsed ?? event.rawBody} />
            </div>
            <div>
              <p className="mb-1 text-xs text-ink-500">Our response</p>
              {command ? (
                <Json value={command} />
              ) : (
                <p className="text-xs text-ink-500">No response recorded.</p>
              )}
            </div>
          </div>
        </details>
      </div>
    </details>
  )
}

export function CallbackLog({ events }: { events: WebhookEventRow[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-ink-600">
        Callbacks not received yet. Jobo calls once its browser agent has opened the page and found
        the form — usually within a minute of the application starting.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {events.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}
    </div>
  )
}
