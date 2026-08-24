import Link from 'next/link'
import { desc } from 'drizzle-orm'
import { db } from '@/db/client'
import { profiles, type ApplicationRow, type StepRow } from '@/db/schema'
import { config, configIssues } from '@/lib/config'
import { getSandboxScenarios } from '@/lib/jobo/client'
import { explainCode } from '@/lib/jobo/problem'
import type { SandboxScenario } from '@/lib/jobo/sandbox'
import { readSnippet } from '@/lib/snippets'
import { isTerminal } from '@/lib/status'
import {
  getNotebookState,
  getTutorialState,
  latestApplication,
  tutorialRecap
} from '@/lib/tutorial'
import { SetupShell } from '@/components/SetupShell'
import { NotebookCell } from '@/components/NotebookCell'
import { TraceTable } from '@/components/TraceTable'
import { TeachPanel } from '@/components/TeachPanel'
import { CodeBlock } from '@/components/CodeBlock'
import { ChecklistCard, type ChecklistItem } from '@/components/ChecklistCard'
import { SuccessPanel } from '@/components/SuccessPanel'
import { ApplyForm } from '@/components/ApplyForm'
import { StatusTimeline } from '@/components/StatusTimeline'
import { AutoRunner } from '@/components/AutoRunner'
import { ValidationProbe } from '@/components/ValidationProbe'
import { ApplicationInspector, loadApplicationView, type ApplicationView } from '@/components/ApplicationInspector'
import { Accordion, Badge, ButtonLink, Json, Panel, StatusBadge } from '@/components/ui'

export const dynamic = 'force-dynamic'
// Cell 1 and cell 3 hold blocking exchanges with Jobo for minutes at a time —
// do not let a platform default cut them off first.
export const maxDuration = 600

/**
 * The tutorial — one page, notebook-style.
 *
 * Three cells, mirroring the three moments of the synchronous Auto Apply
 * loop: the blocking create that hands you the form's fields, the free
 * validation that checks answers before anything touches the employer, and
 * the answer engine driving submit-after-submit to a terminal state. Cells
 * unlock top to bottom, and every state is derived from real rows — see
 * lib/tutorial.ts. The page follows one application (?app=, else the newest).
 */

const ENV_CHECKS: { key: string; title: string; description: string }[] = [
  {
    key: 'JOBO_API_KEY',
    title: 'Jobo API key',
    description: 'A jbe_test_ or jbe_live_ key. Master keys are rejected on Auto Apply routes.'
  },
  {
    key: 'RESUME_URL_SIGNING_SECRET',
    title: 'Resume URL signing secret',
    description: 'Signs the short-lived resume download links. Generate with openssl rand -base64 32.'
  },
  {
    key: 'OPENROUTER_API_KEY',
    title: 'OpenRouter key',
    description: 'Answers the open-ended questions your deterministic rules cannot.'
  }
]

const CREATE_WIRE_SAMPLE = `POST /api/auto-apply/applications HTTP/1.1
Host: connect.jobo.world
X-Api-Key: jbe_test_...
Idempotency-Key: 3f6d1c2a-9d0e-4b7a-8f21-5a4c9e8b7d10
Content-Type: application/json

{ "apply_url": "https://sandbox.jobo.world/ats/apply/..." }

... the connection is HELD while a browser session opens the page
... and discovers the form — typically 10s to 3 minutes

HTTP/1.1 200 OK

{
  "id": "...",
  "status": "awaiting_answers",
  "current_step": {
    "sequence": 1,
    "correction_round": 0,
    "answers_expire_at": "2026-08-13T12:03:00Z",
    "fields": [ ... ]
  }
}`

const SUBMIT_WIRE_SAMPLE = `POST /api/auto-apply/applications/{id}/answers HTTP/1.1
Idempotency semantics: exactly once per correction round

{ "answers": [ ... complete snapshot ... ], "correction_round": 0 }

... validated synchronously (a bad value would 400 HERE, for free) ...
... then HELD while the agent fills the form and clicks through ...

HTTP/1.1 200 OK

{ "status": "submitted", ... }   ← or the next step, or a correction round`

export default async function NotebookPage({
  searchParams
}: {
  searchParams: Promise<{ app?: string }>
}) {
  const { app: pinnedId } = await searchParams

  const issues = configIssues()
  const envReady = issues.length === 0

  // The application this notebook run follows.
  const targetId = pinnedId ?? latestApplication()?.id
  // Guarded on envReady: loading the view syncs against the Jobo API, which
  // needs a valid config. With a broken env the cells are locked anyway.
  const view = envReady && targetId ? await loadApplicationView(targetId) : null

  const nb = getNotebookState(envReady, view?.application ?? null, view?.steps ?? [])
  const state = getTutorialState()

  const profileRows = db.select().from(profiles).orderBy(desc(profiles.createdAt)).all()

  // Sandbox scenarios degrade to the plain URL input, exactly like the form.
  let scenarios: SandboxScenario[] = []
  let sandboxAvailable = false
  let sandboxNote: string | null = null
  if (envReady) {
    try {
      const response = await getSandboxScenarios()
      sandboxAvailable = response.available
      scenarios = response.scenarios.filter((scenario) => scenario.apply_url)
      if (!response.available) sandboxNote = 'the sandbox is not enabled on this deployment yet'
      else if (scenarios.length === 0) sandboxNote = 'no scenarios are published right now'
    } catch (error) {
      sandboxNote = `could not load scenarios (${error instanceof Error ? error.message : String(error)})`
    }
  } else {
    sandboxNote = 'fix the environment first'
  }

  const application = view?.application ?? null
  const stepRows = view?.steps ?? []
  const open =
    application !== null &&
    !isTerminal(application.status) &&
    application.status !== 'create_failed'

  return (
    <SetupShell
      eyebrow="Notebook"
      title="The whole loop, on one page"
      description="Three cells: the blocking create that hands you the form's fields, the free validation that checks answers before anything touches the employer, and the answer engine driving the loop to a terminal state. No webhooks, no tunnels — the response to each call IS the next state."
    >
      <div className="space-y-6">
        {/* Nothing above cell 1 when the app can actually run — the notebook
            opens on the code, not on chrome. The setup panel is a failure
            state, not a permanent fixture. */}
        {!envReady && <SetupRequired issues={issues} />}

        {/* ── Cell 1 · create ─────────────────────────────────────────────── */}
        <NotebookCell
          index={1}
          title="Create — and block until the fields arrive"
          state={nb.create}
          lockedNote="setup incomplete"
          output={application ? <CreateOutput application={application} steps={stepRows} /> : undefined}
          footer={
            <>
              <Accordion eyebrow="The wire" title="What actually crosses the network">
                <CodeBlock label="The wire" language="http" code={CREATE_WIRE_SAMPLE} />
              </Accordion>
              <Accordion eyebrow="When create fails" title="The error taxonomy is part of the API">
                <ul className="list-disc space-y-1 pl-4 text-sm leading-6 text-ink-600">
                  <li>
                    <code className="code-chip text-xs">unsupported_ats</code> — no provider
                    matched the URL.
                  </li>
                  <li>
                    <code className="code-chip text-xs">idempotency_key_reuse</code> — same key,
                    different body. Keys bind to the exact body for 24 hours.
                  </li>
                  <li>
                    <code className="code-chip text-xs">application_quota_exceeded</code> — 5 live
                    per 24h, 20 sandbox per hour, 5 in flight.
                  </li>
                  <li>
                    A <em>dropped connection</em> is not a failure: retrying with the same{' '}
                    <code className="code-chip text-xs">Idempotency-Key</code> re-attaches to the
                    in-flight application and its blocking wait.
                  </li>
                </ul>
              </Accordion>
            </>
          }
        >
          <CodeBlock
            label="app/actions/applications.ts"
            language="ts"
            code={readSnippet('app/actions/applications.ts', 'The ordering here is the point', '.run()')}
          />
          <p className="text-sm leading-6 text-ink-600">
            One POST with an <code className="code-chip text-xs">Idempotency-Key</code> that is
            written to the local database <em>before</em> the network call. The call then{' '}
            <em>blocks</em> — typically 10s to 3 minutes — until Jobo&apos;s browser session has
            opened the page, found the form, and can hand back the fields in{' '}
            <code className="code-chip text-xs">current_step</code>. If the connection drops
            mid-hold, the stored key re-attaches to the same application.
          </p>
          <div className="border-t hairline pt-4">
            <ApplyForm
              profiles={profileRows.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault }))}
              scenarios={scenarios}
              sandboxAvailable={sandboxAvailable && scenarios.length > 0}
              sandboxNote={sandboxNote}
              defaultSandbox={envReady ? config().DEFAULT_SANDBOX : true}
              redirectPrefix="/learn?app="
              runButton
            />
            <p className="mt-3 text-xs text-ink-500">
              Answers are produced from the selected profile. Two fictional samples ship with the
              app — add or edit profiles on the{' '}
              <Link href="/profiles" className="font-medium text-brand hover:text-brand-deep hover:underline">
                Profiles
              </Link>{' '}
              page.
            </p>
          </div>
        </NotebookCell>

        <TeachPanel eyebrow="Before you answer" title="A real browser is holding the form open" tone="warn">
          <p>
            Every answerable step carries{' '}
            <code className="font-mono text-xs">answers_expire_at</code> — about 3 minutes, 60
            seconds for one-time verification codes. Miss it and the application fails with{' '}
            <code className="font-mono text-xs">answers_timeout</code>. So read fast, or run cell
            3 and read afterwards: the audit trail keeps everything.
          </p>
        </TeachPanel>

        {/* ── Cell 2 · validation is free ─────────────────────────────────── */}
        <NotebookCell
          index={2}
          title="Send a bad answer — validation is free"
          state={nb.validate}
          lockedNote="waits on cell 1"
          output={
            nb.validate === 'running' ? (
              <div className="space-y-3">
                <p className="text-sm text-ink-600">
                  Jobo is still discovering the form (the create hold returned a snapshot before
                  the fields were ready). Check again in a moment.
                </p>
                <ButtonLink href={pinnedId ? `/learn?app=${pinnedId}` : '/learn'} variant="secondary" size="sm">
                  Check again
                </ButtonLink>
              </div>
            ) : nb.validate === 'done' ? (
              <p className="text-sm text-ink-600">
                This round has been answered — the probe needs an open step. Run cell 1 again to
                replay it on a fresh application.
              </p>
            ) : undefined
          }
          footer={
            <Accordion eyebrow="Why this matters" title="This used to burn a correction round">
              <p className="text-sm leading-6 text-ink-600">
                Only the employer ATS&apos;s own rejections consume one of the 3 correction
                rounds (<code className="font-mono text-xs">correction_round</code> increments and{' '}
                <code className="font-mono text-xs">command_errors</code> says what the ATS
                refused). Client-side mistakes — wrong types, unadvertised option values, length
                overruns — are caught synchronously, before anything touches the form, and cost
                nothing. That is why this app no longer ships a local port of Jobo&apos;s
                validator: the server IS the validator, for free.
              </p>
            </Accordion>
          }
        >
          <CodeBlock
            label="app/learn/actions.ts"
            language="ts"
            code={readSnippet('app/learn/actions.ts', 'A value of the wrong JSON type', 'return 42')}
          />
          <p className="text-sm leading-6 text-ink-600">
            The step is live and a real browser is holding the employer&apos;s form open — and
            this button is still completely safe.{' '}
            <code className="code-chip text-xs">submitAnswers</code> validates the snapshot{' '}
            <em>before</em> anything is typed into the form; a bad value is an immediate{' '}
            <code className="code-chip text-xs">400</code> carrying per-field errors, and the step
            stays exactly where it was.
          </p>
          {application && nb.validate === 'ready' && <ValidationProbe id={application.id} />}
        </NotebookCell>

        {/* ── Cell 3 · the loop ───────────────────────────────────────────── */}
        <NotebookCell
          index={3}
          title="Answer, submit, repeat — to a terminal state"
          state={nb.answer}
          lockedNote="waits on cell 1"
          output={
            application ? <AnswerOutput application={application} steps={stepRows} /> : undefined
          }
          footer={
            <>
              <Accordion eyebrow="The wire" title="What the blocking submit looks like">
                <CodeBlock label="The wire" language="http" code={SUBMIT_WIRE_SAMPLE} />
              </Accordion>
              <Accordion eyebrow="Correction rounds" title="When the employer's ATS pushes back">
                <p className="text-sm leading-6 text-ink-600">
                  If the ATS rejects a value after filling — something client-side validation
                  cannot predict — the same step comes back with{' '}
                  <code className="font-mono text-xs">correction_round</code> incremented and{' '}
                  <code className="font-mono text-xs">command_errors</code> quoting what it said.
                  The engine re-answers only the rejected fields and re-sends a complete
                  snapshot. After 3 failed rounds the application fails with{' '}
                  <code className="font-mono text-xs">correction_limit_exceeded</code>.
                </p>
              </Accordion>
            </>
          }
        >
          <CodeBlock
            label="lib/answers/index.ts"
            language="ts"
            code={readSnippet('lib/answers/index.ts', 'The answer pipeline:', 'fix-and-retry.')}
          />
          <CodeBlock
            label="app/actions/applications.ts"
            language="ts"
            code={readSnippet(
              'app/actions/applications.ts',
              'Free per-field validation errors',
              'answers = repaired'
            )}
          />
          <p className="text-sm leading-6 text-ink-600">
            Run starts the loop: answer the current step from the profile, submit — the call
            blocks while Jobo fills the form and clicks through — and whatever comes back is the
            next step, a correction round, or the terminal result. If the free validation refuses
            the snapshot, the repair pass fixes it from the server&apos;s own error list and
            retries once.
          </p>
          {application && (
            <AutoRunner id={application.id} active={open} autoStart={false} startLabel="Run the loop" />
          )}
        </NotebookCell>

        {view && (
          <Accordion
            eyebrow="Inspector"
            title="The full exchange — every step, fields and answers included"
            summary={`${stepRows.length} exchange${stepRows.length === 1 ? '' : 's'}`}
          >
            <ApplicationInspector view={view} />
          </Accordion>
        )}

        {state.complete && <CompletionFooter />}
      </div>
    </SetupShell>
  )
}

// ─── Setup failure state ─────────────────────────────────────────────────────

/**
 * Shown ONLY when the environment cannot work. There is no permanent "runtime"
 * chrome above the cells: when the app can run, the notebook opens on the code
 * rather than on a status bar you have already read once.
 */
function SetupRequired({ issues }: { issues: { key: string; message: string }[] }) {
  const issueByKey = new Map(issues.map((issue) => [issue.key, issue.message]))

  return (
    <Panel
      eyebrow="Before you can run this"
      title="Finish your setup"
      actions={
        <Badge tone="bad" dot>
          {issues.length} missing
        </Badge>
      }
    >
      <p className="text-sm leading-6 text-ink-600">
        Copy <code className="code-chip text-xs">.env.example</code> to{' '}
        <code className="code-chip text-xs">.env.local</code>, fill it in, and restart the dev
        server. The cells below unlock on their own once these pass. No tunnel, no webhook
        secret, no public URL — the loop is plain HTTPS calls from this app to Jobo.
      </p>

      <ul className="mt-4 divide-y hairline border-y hairline">
        {ENV_CHECKS.map((check) => {
          const problem = issueByKey.get(check.key)
          return (
            <li key={check.key} className="flex items-baseline gap-3 py-2.5 text-sm">
              <span
                className={`w-3 shrink-0 font-mono ${problem ? 'text-danger-deep' : 'text-success-deep'}`}
              >
                {problem ? '✗' : '✓'}
              </span>
              <div className="min-w-0">
                <code className="code-chip text-xs">{check.key}</code>
                <span className="ml-2 text-ink-600">{problem ?? check.description}</span>
              </div>
            </li>
          )
        })}
      </ul>

      <p className="mt-4 text-xs leading-5 text-ink-500">
        <code className="code-chip">PUBLIC_BASE_URL</code> is optional: it is only needed to serve
        resume files for <code className="code-chip">file</code> fields (Jobo downloads them from
        a public HTTPS URL). Without it the answer engine skips file fields and says so in the
        trace. Verify the rest with <code className="code-chip">npm run doctor</code>.
      </p>
    </Panel>
  )
}

// ─── Cell outputs ────────────────────────────────────────────────────────────

/** Oldest recorded step round — the one the create hold produced. */
function firstStep(steps: StepRow[]): StepRow | undefined {
  return steps[steps.length - 1]
}

/** Most recent submitted round, for cell 3's answer display. */
function latestAnswered(steps: StepRow[]): StepRow | undefined {
  return steps.find((step) => step.submittedAt !== null)
}

/** Cell 1's output: the create exchange — hold time included — success or failure. */
function CreateOutput({ application, steps }: { application: ApplicationRow; steps: StepRow[] }) {
  const first = firstStep(steps)
  // How long the create call was held before the fields arrived: the first
  // step's receipt (or the first sync, on a 202 snapshot) minus row creation.
  const settledAt = first?.receivedAt ?? application.lastSyncedAt
  const holdSeconds =
    application.joboApplicationId && settledAt
      ? Math.max(0, (settledAt - application.createdAt) / 1000)
      : null

  return (
    <>
      <div>
        <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.05em] text-ink-500">
          POST /api/auto-apply/applications
        </p>
        <Json
          value={{
            apply_url: application.applyUrl,
            idempotency_key: application.idempotencyKey
          }}
        />
      </div>

      {application.status === 'creating' && (
        <p className="text-sm text-ink-600">
          Request in flight — the connection is being held while the agent finds the form…
        </p>
      )}

      {application.joboApplicationId && (
        <div>
          <div className="mb-1 flex items-center justify-between gap-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-ink-500">
              Response
            </p>
            {holdSeconds !== null && (
              <span className="text-xs tabular-nums text-ink-500">
                connection held {holdSeconds.toFixed(1)}s before the fields arrived
              </span>
            )}
          </div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge tone="good" dot>
              200 OK
            </Badge>
            {first && <Badge>current_step · {first.fieldsJson?.length ?? 0} fields</Badge>}
          </div>
          <Json
            value={{
              id: application.joboApplicationId,
              status: application.status,
              provider_name: application.providerName,
              ...(first
                ? {
                    current_step: {
                      sequence: first.sequence,
                      correction_round: first.correctionRound,
                      fields: first.fieldsJson ?? []
                    }
                  }
                : {})
            }}
          />
        </div>
      )}

      {application.status === 'create_failed' && (
        <div className="bg-danger-tint px-3 py-2 text-sm text-danger-deep">
          <code className="mr-2 font-mono text-xs">{application.createErrorCode}</code>
          {application.createErrorMessage}
          <span className="mt-1 block text-xs">
            Fix the cause and press Run again — a fresh row gets a fresh Idempotency-Key.
          </span>
        </div>
      )}
    </>
  )
}

/** Cell 3's output: the live timeline, the submitted answers, and the outcome. */
function AnswerOutput({ application, steps }: { application: ApplicationRow; steps: StepRow[] }) {
  const answered = latestAnswered(steps)
  const terminal = isTerminal(application.status)
  const gloss = application.failureCode ? explainCode(application.failureCode) : null

  return (
    <>
      <StatusTimeline application={application} steps={steps} />

      {answered && (
        <div>
          <div className="mb-1 flex items-center justify-between gap-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-ink-500">
              Answers · step {answered.sequence}
              {answered.correctionRound > 0 ? ` · correction round ${answered.correctionRound}` : ''}
            </p>
            {answered.totalMs !== null && (
              <span className="text-xs tabular-nums text-ink-500">
                answered in {(answered.totalMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            <Json value={{ answers: answered.answersJson ?? [] }} />
          </div>
        </div>
      )}

      {answered?.trace && answered.trace.length > 0 && (
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.05em] text-ink-500">
            How each field was answered
          </p>
          <TraceTable trace={answered.trace} />
        </div>
      )}

      {terminal && (
        <div className="flex flex-wrap items-center gap-3 border hairline bg-white px-3 py-2.5">
          <StatusBadge status={application.status} />
          <p className="text-sm text-ink-600">
            {application.status === 'submitted' &&
              'The form went through — the last blocking call resolved to the terminal state and the loop is complete.'}
            {application.status === 'failed' && (
              <>
                <code className="code-chip mr-2 text-xs">{application.failureCode}</code>
                {gloss ?? application.failureMessage}
              </>
            )}
            {application.status === 'canceled' &&
              'Canceled cleanly — a valid outcome, not an error.'}
          </p>
        </div>
      )}
    </>
  )
}

// ─── Completion footer ───────────────────────────────────────────────────────

function CompletionFooter() {
  const recap = tutorialRecap()

  const nextSteps: ChecklistItem[] = [
    {
      key: 'live',
      title: 'Rotate to live mode',
      description:
        'Swap jbe_test_ for jbe_live_ in .env.local and apply to a real job URL. Live quota is 5 creates per 24 hours.'
    },
    {
      key: 'correction',
      title: 'Trigger a correction round',
      description:
        'Edit your profile so an option cannot match (an unusual country spelling works), run cell 1 again, and watch the same step come back with command_errors and correction_round: 1.'
    },
    {
      key: 'files',
      title: 'Serve resume files',
      description:
        'Set PUBLIC_BASE_URL to a public HTTPS origin and the engine starts answering file fields with signed, expiring resume URLs.'
    },
    {
      key: 'read',
      title: 'Read the ★ files',
      description:
        'app/actions/applications.ts · lib/answers/index.ts · components/AutoRunner.tsx — the whole integration is those three, because @jobo-ai/autoapply is the rest.'
    }
  ]

  return (
    <div className="space-y-6">
      <SuccessPanel
        eyebrow="Notebook complete"
        title="You've seen the whole loop"
        actions={
          <>
            <ButtonLink href="/">Open the workbench</ButtonLink>
            <ButtonLink href="#cell-1" variant="secondary">
              Run it again
            </ButtonLink>
          </>
        }
      >
        <p>
          {recap.answeredSteps} step{recap.answeredSteps === 1 ? '' : 's'} answered across{' '}
          {recap.exchanges} exchange{recap.exchanges === 1 ? '' : 's'} · {recap.byRule} answer
          {recap.byRule === 1 ? '' : 's'} by rule, {recap.byAi} by AI, {recap.repaired} repaired
          {recap.lastTerminal
            ? ` · last application ${recap.lastTerminal.status}${
                recap.lastTerminal.providerName ? ` (${recap.lastTerminal.providerName})` : ''
              }`
            : ''}
          .
        </p>
      </SuccessPanel>

      <ChecklistCard title="What's next" items={nextSteps} />

      <TeachPanel eyebrow="The loop in five lines" title="Everything that matters">
        <ol className="list-decimal space-y-1.5 pl-4">
          <li>create() blocks until the first step&apos;s fields arrive in current_step.</li>
          <li>Answer before answers_expire_at — a real browser is holding the form open.</li>
          <li>submitAnswers() validates for free, then blocks until the next state.</li>
          <li>A 400 costs nothing; only the ATS&apos;s own rejections burn a correction round (3 max).</li>
          <li>Dropped connections re-attach: same Idempotency-Key, or get(id, waitSeconds).</li>
        </ol>
      </TeachPanel>
    </div>
  )
}
