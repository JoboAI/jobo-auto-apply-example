import { count, inArray, isNotNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { applications, steps } from '@/db/schema'
import type { ApplicationRow, StepRow } from '@/db/schema'
import { configIssues } from '@/lib/config'
import { isTerminal } from '@/lib/status'

/**
 * Notebook progress.
 *
 * Nothing here is stored. Every state is DERIVED, per request, from the same
 * state the integration actually produces: environment variables, an
 * application with a Jobo id, a recorded step, a terminal status.
 *
 * That is deliberate and on-message. The notebook cannot drift from reality —
 * if you delete `.data/` it honestly resets. Two indexed SQLite reads per
 * request is the entire cost.
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
  /** Cell 1 — the blocking create hands back the first step's fields. */
  create: CellState
  /** Cell 2 — a deliberately bad answer meets the free validation 400. */
  validate: CellState
  /** Cell 3 — the answer engine drives the loop to a terminal status. */
  answer: CellState
}

/**
 * Pure derivation from the application the page is following and its recorded
 * steps. Rows in, states out — no reads here, so the edges are trivially
 * unit-testable.
 */
export function getNotebookState(
  envReady: boolean,
  app: ApplicationRow | null,
  stepRows: StepRow[]
): NotebookCells {
  const created = Boolean(app?.joboApplicationId)
  const terminal = app ? isTerminal(app.status) : false
  const awaiting = app?.status === 'awaiting_answers'
  const answered = stepRows.some((step) => step.submittedAt !== null)

  const create: CellState = !envReady
    ? 'locked'
    : app?.status === 'creating'
      ? 'running'
      : created
        ? 'done'
        : // No application yet, or a create_failed — either way the Run
          // button is live again, with the failure shown in the output.
          'ready'

  // The validation cell needs a step that is genuinely open: the probe posts
  // real (bad) answers to the live application. Once a round was answered or
  // the application finished, its teaching moment has passed.
  const validate: CellState = !created
    ? 'locked'
    : answered || terminal
      ? 'done'
      : awaiting
        ? 'ready'
        : // Between create and the first fields (a 202 snapshot): Jobo is
          // still working, and the cell will unlock when the fields land.
          'running'

  const answer: CellState =
    !created || (!awaiting && !answered && !terminal)
      ? 'locked'
      : terminal
        ? 'done'
        : awaiting && !answered
          ? 'ready'
          : 'running'

  return { create, validate, answer }
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

/** Aggregates for the completion footer, from the steps audit table. */
export function tutorialRecap() {
  const rows = db
    .select({
      trace: steps.trace,
      submittedAt: steps.submittedAt
    })
    .from(steps)
    .all()

  let exchanges = 0
  let answeredSteps = 0
  let byRule = 0
  let byAi = 0
  let repaired = 0

  for (const row of rows) {
    exchanges += 1
    if (row.submittedAt) answeredSteps += 1
    for (const entry of row.trace ?? []) {
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

  return { exchanges, answeredSteps, byRule, byAi, repaired, lastTerminal: lastTerminal ?? null }
}

/** Health regressions to surface on the workbench after completion. */
export function envRegressed(): boolean {
  return configIssues().length > 0
}
