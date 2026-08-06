import { count, inArray, isNotNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { applications, webhookEvents } from '@/db/schema'
import type { ApplicationRow, WebhookEventRow } from '@/db/schema'
import { configIssues } from '@/lib/config'
import { isTerminal } from '@/lib/status'

/**
 * Notebook progress.
 *
 * Nothing here is stored. Every state is DERIVED, per request, from the same
 * state the integration actually produces: environment variables, an
 * application with a Jobo id, a received callback, a terminal status.
 *
 * That is deliberate and on-message. The notebook cannot drift from reality —
 * if you delete `.data/` it honestly resets, and if your tunnel hostname goes
 * stale the runtime strip reopens. Two indexed SQLite reads per request is
 * the entire cost.
 */

// ─── Global milestones (layout chip, front-door routing) ────────────────────

export interface TutorialState {
  envReady: boolean
  /** Any application anywhere reached Jobo (has a Jobo id). */
  created: boolean
  /** Any application anywhere reached a terminal status. */
  terminal: boolean
  /** 1-based first incomplete milestone: env → create → terminal. */
  milestone: 1 | 2 | 3
  complete: boolean
}

export function getTutorialState(): TutorialState {
  const envReady = configIssues().length === 0

  const created =
    (db
      .select({ value: count() })
      .from(applications)
      .where(isNotNull(applications.joboApplicationId))
      .get()?.value ?? 0) > 0

  const terminal =
    (db
      .select({ value: count() })
      .from(applications)
      .where(inArray(applications.status, ['submitted', 'failed', 'canceled']))
      .get()?.value ?? 0) > 0

  const done = [envReady, created, terminal]
  const firstOpen = done.findIndex((value) => !value)
  const milestone = (firstOpen === -1 ? 3 : firstOpen + 1) as 1 | 2 | 3

  return { envReady, created, terminal, milestone, complete: firstOpen === -1 }
}

// ─── Per-cell states for the notebook page ───────────────────────────────────

export type CellState = 'locked' | 'ready' | 'running' | 'done'

export interface NotebookCells {
  /** Cell 1 — create the application. */
  create: CellState
  /** Cell 2 — Jobo calls your webhook. */
  callback: CellState
  /** Cell 3 — your app answers, autonomously. */
  respond: CellState
}

/**
 * Pure derivation from the application the page is following. Rows in,
 * states out — no reads here, so the edges are trivially unit-testable.
 */
export function getNotebookState(
  envReady: boolean,
  app: ApplicationRow | null,
  events: WebhookEventRow[]
): NotebookCells {
  const created = Boolean(app?.joboApplicationId)
  const fields = events.filter((event) => event.type === 'application.fields_requested')
  const terminal = app ? isTerminal(app.status) : false

  const create: CellState = !envReady
    ? 'locked'
    : app?.status === 'creating'
      ? 'running'
      : created
        ? 'done'
        : // No application yet, or a create_failed — either way the Run
          // button is live again, with the failure shown in the output.
          'ready'

  const callback: CellState = !created
    ? 'locked'
    : fields.length > 0 || terminal
      ? // A terminal event is also a webhook call: an application can fail
        // before any fields are requested, and that still completes this cell.
        'done'
      : 'running'

  const respond: CellState = fields.length === 0 ? 'locked' : terminal ? 'done' : 'running'

  return { create, callback, respond }
}

/** The application the notebook follows when no ?app= is pinned: the newest
 *  row, INCLUDING create failures — cell 1's output has to show those too. */
export function latestApplication(): { id: string } | null {
  const row = db
    .select({ id: applications.id })
    .from(applications)
    .orderBy(applications.createdAt)
    .all()
    .at(-1)
  return row ?? null
}

/** Aggregates for the completion footer. */
export function tutorialRecap() {
  const events = db
    .select({
      type: webhookEvents.type,
      trace: webhookEvents.trace,
      totalMs: webhookEvents.totalMs
    })
    .from(webhookEvents)
    .all()

  let callbacks = 0
  let byRule = 0
  let byAi = 0
  let repaired = 0

  for (const event of events) {
    callbacks += 1
    for (const entry of event.trace ?? []) {
      if (entry.source === 'deterministic') byRule += 1
      else if (entry.source === 'llm') byAi += 1
      else if (entry.source === 'repaired') repaired += 1
    }
  }

  const lastTerminal = db
    .select({ status: applications.status, providerName: applications.providerName })
    .from(applications)
    .where(inArray(applications.status, ['submitted', 'failed', 'canceled']))
    .orderBy(applications.updatedAt)
    .all()
    .at(-1)

  return { callbacks, byRule, byAi, repaired, lastTerminal: lastTerminal ?? null }
}

/** Health regressions to surface on the workbench after completion. */
export function envRegressed(): boolean {
  return configIssues().length > 0
}
