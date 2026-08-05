import { count, inArray, isNotNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { applications, profiles, webhookEvents } from '@/db/schema'
import { configIssues } from '@/lib/config'

/**
 * Tutorial progress.
 *
 * Nothing here is stored. Every step's completion is DERIVED, per request,
 * from the same state the integration actually produces: environment
 * variables, a profile row, an application with a Jobo id, a terminal status.
 *
 * That is deliberate and on-message. The tutorial cannot drift from reality —
 * if you delete `.data/` it honestly regresses to step 2, and if your tunnel
 * hostname goes stale the setup step reopens. Three indexed SQLite reads per
 * request is the entire cost.
 */

export const TUTORIAL_STEPS = [
  {
    slug: 'connect',
    label: 'Verify your setup',
    description: 'Keys, secret, and a public callback'
  },
  {
    slug: 'profile',
    label: 'Own the profile',
    description: 'The half Jobo deliberately does not store'
  },
  {
    slug: 'create',
    label: 'Create an application',
    description: 'The only request you make'
  },
  {
    slug: 'watch',
    label: 'Answer the callback',
    description: 'Watch your webhook do the work'
  },
  { slug: 'done', label: 'Go live', description: 'The contract, recapped' }
] as const

export type TutorialSlug = (typeof TUTORIAL_STEPS)[number]['slug']

export interface TutorialState {
  steps: { slug: TutorialSlug; label: string; description: string; done: boolean }[]
  /** 1-based index of the first incomplete step (5 when all done). */
  currentStep: number
  /** Steps at or below this index are navigable. */
  highestAvailableStep: number
  complete: boolean
}

export function getTutorialState(): TutorialState {
  const envReady = configIssues().length === 0

  const profileCount = db.select({ value: count() }).from(profiles).get()?.value ?? 0

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

  const done = [envReady, profileCount > 0, created, terminal, terminal]

  const steps = TUTORIAL_STEPS.map((step, index) => ({ ...step, done: done[index] }))

  const firstOpen = done.findIndex((value) => !value)
  const currentStep = firstOpen === -1 ? 5 : firstOpen + 1

  // Consecutive-completion gating: you can revisit anything you have finished
  // plus the step you are on. Once step 4 is done, everything unlocks forever.
  let consecutive = 0
  while (consecutive < 4 && done[consecutive]) consecutive += 1
  const complete = consecutive >= 4

  return {
    steps,
    currentStep,
    highestAvailableStep: complete ? 5 : consecutive + 1,
    complete
  }
}

export function stepIndex(slug: string): number {
  return TUTORIAL_STEPS.findIndex((step) => step.slug === slug) + 1
}

/** The latest application worth watching in step 4, newest first. */
export function latestWatchTarget(): { id: string } | null {
  const row = db
    .select({ id: applications.id })
    .from(applications)
    .where(isNotNull(applications.joboApplicationId))
    .orderBy(applications.createdAt)
    .all()
    .at(-1)
  return row ?? null
}

/** Aggregates for the completion recap on /learn/done. */
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
