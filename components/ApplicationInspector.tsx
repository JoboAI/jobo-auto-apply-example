import { desc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { applications, steps, type ApplicationRow, type StepRow } from '@/db/schema'
import { refreshIfStale } from '@/app/actions/applications'
import { jobo } from '@/lib/jobo/client'
import { explainCode } from '@/lib/jobo/problem'
import type { Application } from '@jobo-ai/autoapply'
import { Accordion, Panel } from './ui'
import { StepLog } from './StepLog'

/**
 * Everything there is to see about one application: our step-by-step audit
 * log, plus Jobo's own view of the same steps. Shared by the tutorial's third
 * cell and the /applications/[id] reference page, so the two can never
 * diverge.
 */

export interface ApplicationView {
  application: ApplicationRow
  /** Step rounds from the local audit table, most recent first. */
  steps: StepRow[]
  detail: Application | null
}

/** Load one application with its steps and Jobo's view, refreshing if stale. */
export async function loadApplicationView(id: string): Promise<ApplicationView | null> {
  // The advance loop is the primary driver; this covers a page opened
  // mid-flight or after the loop already finished.
  await refreshIfStale(id)

  const application = db.select().from(applications).where(eq(applications.id, id)).get()
  if (!application) return null

  const stepRows = db
    .select()
    .from(steps)
    .where(eq(steps.applicationId, id))
    .orderBy(desc(steps.receivedAt), desc(steps.correctionRound))
    .all()

  let detail: Application | null = null
  if (application.joboApplicationId) {
    detail = await jobo().applications.get(application.joboApplicationId).catch(() => null)
  }

  return { application, steps: stepRows, detail }
}

export function ApplicationInspector({ view }: { view: ApplicationView }) {
  const { application, steps: stepRows, detail } = view
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
        title="Step log"
        actions={
          <span className="text-xs text-ink-500">
            {stepRows.length} exchange{stepRows.length === 1 ? '' : 's'}
          </span>
        }
      >
        <StepLog steps={stepRows} />
      </Panel>

      {detail && (
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
      )}
    </div>
  )
}
