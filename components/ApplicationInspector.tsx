import { desc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { applications, webhookEvents, type ApplicationRow, type WebhookEventRow } from '@/db/schema'
import { refreshIfStale } from '@/app/actions/applications'
import { jobo } from '@/lib/jobo/client'
import { explainCode } from '@/lib/jobo/problem'
import type { Application } from '@jobo-ai/autoapply'
import { Accordion, Panel } from './ui'
import { CallbackLog } from './CallbackLog'

/**
 * Everything there is to see about one application: our callback log, plus
 * Jobo's own view of steps and event deliveries. Shared by the tutorial's
 * watch step and the /applications/[id] reference page, so the two can never
 * diverge.
 */

export interface ApplicationView {
  application: ApplicationRow
  events: WebhookEventRow[]
  detail: Application | null
}

/** Load one application with its events and Jobo's view, refreshing if stale. */
export async function loadApplicationView(id: string): Promise<ApplicationView | null> {
  // Webhooks are the primary signal; the GET covers the gaps (tunnel was down,
  // event still retrying, page opened mid-flight).
  await refreshIfStale(id)

  const application = db.select().from(applications).where(eq(applications.id, id)).get()
  if (!application) return null

  const events = db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.applicationId, id))
    .orderBy(desc(webhookEvents.receivedAt))
    .all()

  let detail: Application | null = null
  if (application.joboApplicationId) {
    detail = await jobo().applications.get(application.joboApplicationId).catch(() => null)
  }

  return { application, events, detail }
}

export function ApplicationInspector({ view }: { view: ApplicationView }) {
  const { application, events, detail } = view
  const gloss = application.failureCode ? explainCode(application.failureCode) : null

  return (
    <div className="space-y-6">
      {application.createErrorCode && (
        <Panel title="Could not create this application">
          <p className="text-sm text-ink-800">
            <code className="code-chip mr-2 text-xs">{application.createErrorCode}</code>
            {application.createErrorMessage}
          </p>
          {application.createErrorCode === 'auto_apply_coming_soon' && (
            <p className="mt-2 text-xs text-ink-600">
              Application creation is gated off at the deployment level. Reads, lists and cancels
              still work — see the README for details.
            </p>
          )}
        </Panel>
      )}

      {application.failureCode && (
        <Panel title="Failure">
          <p className="text-sm text-ink-800">
            <code className="code-chip mr-2 text-xs">{application.failureCode}</code>
            {application.failureMessage}
          </p>
          {gloss && <p className="mt-2 text-sm text-ink-600">{gloss}</p>}
          <p className="mt-2 text-xs text-ink-600">
            {application.failureRetryable
              ? 'Jobo reports this as retryable.'
              : 'Jobo reports this as not retryable — do not blindly resubmit.'}
          </p>
        </Panel>
      )}

      <Panel
        title="Callback log"
        actions={
          <span className="text-xs text-ink-500">
            {events.length} event{events.length === 1 ? '' : 's'}
          </span>
        }
      >
        <CallbackLog events={events} />
      </Panel>

      {detail && (
        <div className="space-y-4">
          <Accordion
            title="Steps (Jobo's view)"
            summary={`${detail.steps.length} step${detail.steps.length === 1 ? '' : 's'}`}
          >
            {detail.steps.length === 0 ? (
              <p className="text-sm text-ink-600">No steps yet.</p>
            ) : (
              <ul className="divide-y hairline text-sm">
                {detail.steps.map((step) => (
                  <li key={step.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-ink-800">
                      Step {step.sequence}
                      {step.correction_round > 0 && (
                        <span className="text-ink-600"> · correction {step.correction_round}</span>
                      )}
                    </span>
                    <span className="text-xs tabular-nums text-ink-600">
                      {step.field_count} fields · {step.answer_count} answers · {step.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Accordion>

          {/* One terminal webhook per application, summarised. Per-attempt
              detail — including the exact bodies exchanged — is portal-only,
              like webhook setup and secret rotation. */}
          <Accordion
            title="Terminal delivery (Jobo's view)"
            summary={detail.terminal_delivery ? detail.terminal_delivery.status : 'not sent'}
          >
            {detail.terminal_delivery === null ? (
              <p className="text-sm text-ink-600">
                Not sent yet — an application only produces one once it reaches a terminal state.
              </p>
            ) : (
              <div className="py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <code className="font-mono text-xs text-ink-800">
                    {detail.terminal_delivery.type.replace('application.', '')}
                  </code>
                  <span className="text-xs text-ink-600">
                    {detail.terminal_delivery.status} · {detail.terminal_delivery.attempt_count}{' '}
                    attempt
                    {detail.terminal_delivery.attempt_count === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-600">
                  {detail.terminal_delivery.delivered_at
                    ? `Delivered ${detail.terminal_delivery.delivered_at}`
                    : 'Not yet delivered — Jobo retries over ~24h.'}
                </p>
              </div>
            )}
          </Accordion>
        </div>
      )}
    </div>
  )
}
