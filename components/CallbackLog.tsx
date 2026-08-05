import type { WebhookEventRow } from '@/db/schema'
import type { AnswerCommand, FieldsRequestedEvent } from '@jobo-ai/autoapply'
import { Badge, Json, relativeTime } from './ui'

/**
 * The callback log — a request bin for the one exchange that matters.
 *
 * This is why `webhook_events` stores `raw_body` and `response_body` verbatim
 * rather than a summary: when the integration misbehaves you want the exact
 * bytes Jobo sent and the exact bytes you returned. It also outlives the data
 * upstream — Jobo purges sandbox applications after 24h.
 *
 * Deliberately just those two things. This panel used to open with a table of
 * every discovered field and a second explaining how each answer was chosen,
 * which pushed the bodies below the fold — and both restated what the JSON
 * beneath them already said.
 */

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

  const commandErrors =
    event.type === 'application.fields_requested' ? (parsed?.step?.command_errors ?? []) : []

  return (
    <details className="panel" open>
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
          {event.totalMs !== null ? `${(event.totalMs / 1000).toFixed(1)}s · ` : ''}
          {relativeTime(event.receivedAt)}
        </span>
      </summary>

      <div className="space-y-4 border-t hairline px-4 py-4">
        {/* The event id, because it is the idempotency key: stable across
            transport retries, and what you grep for on both sides. */}
        <p className="font-mono text-[11px] text-ink-500">{event.id}</p>

        {event.error && (
          <p className="bg-warning-tint px-3 py-2 text-xs text-warning-deep">{event.error}</p>
        )}

        {/* Kept above the bodies on purpose: this is why the previous round was
            rejected, and it is not derivable from the request alone. */}
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

        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.05em] text-ink-500">
            Request · what Jobo sent
          </p>
          <Json value={parsed ?? event.rawBody} />
        </div>

        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.05em] text-ink-500">
            Response · what we returned
          </p>
          {command ? (
            <Json value={command} />
          ) : (
            <p className="text-xs text-ink-500">No response recorded.</p>
          )}
        </div>
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
