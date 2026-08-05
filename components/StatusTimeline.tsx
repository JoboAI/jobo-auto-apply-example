import type { ApplicationRow, WebhookEventRow } from '@/db/schema'
import type { AnswerCommand } from '@jobo-ai/autoapply'
import { explainCode } from '@/lib/jobo/problem'

/**
 * The application lifecycle as a horizontal rail, in the stepper's visual
 * language: filled circles for reached stages, a pulsing purple dot for the
 * current one, hairline connectors between.
 *
 *   created → queued → running → awaiting answers → answered → terminal
 *
 * "answered" is not a Jobo status — it is derived from OUR side of the
 * exchange: the latest fields_requested event has a recorded response whose
 * action was `proceed`. (Checking for the response alone would count a cancel
 * as "answered", which reads wrong.)
 */

const STATUS_RANK: Record<string, number> = {
  creating: 0,
  create_failed: 0,
  queued: 1,
  running: 2,
  awaiting_answers: 3,
  submitted: 5,
  failed: 5,
  canceled: 5
}

function latestFieldsEvent(events: WebhookEventRow[]): WebhookEventRow | undefined {
  return events.find((event) => event.type === 'application.fields_requested')
}

function answeredProceed(event: WebhookEventRow | undefined): boolean {
  if (!event?.respondedAt || !event.responseBody) return false
  try {
    return (JSON.parse(event.responseBody) as AnswerCommand).action === 'proceed'
  } catch {
    return false
  }
}

function statusLine(
  application: ApplicationRow,
  events: WebhookEventRow[],
  rank: number
): { text: string; tone: 'neutral' | 'good' | 'warn' | 'bad' } {
  const fields = latestFieldsEvent(events)

  if ((fields?.correctionRound ?? 0) > 0 && rank < 5) {
    return {
      text: `Jobo rejected some answers — correction round ${fields?.correctionRound} of 3. The full field list was re-sent and must be answered as a complete snapshot.`,
      tone: 'warn'
    }
  }

  switch (application.status) {
    case 'creating':
      return { text: 'Creating the application…', tone: 'neutral' }
    case 'queued':
      return { text: 'Application accepted. A browser agent is picking it up.', tone: 'neutral' }
    case 'running':
      if (rank >= 4 && fields) {
        const answers = countAnswers(fields)
        const seconds = fields.totalMs ? (fields.totalMs / 1000).toFixed(1) : '?'
        return {
          text: `Your app answered ${answers} field${answers === 1 ? '' : 's'} in ${seconds}s. Jobo is filling the form.`,
          tone: 'good'
        }
      }
      return { text: 'The agent is opening the apply URL and discovering the form.', tone: 'neutral' }
    case 'awaiting_answers':
      return { text: 'Fields are on their way to your callback — watch the log below.', tone: 'neutral' }
    case 'submitted':
      return { text: 'Submitted. The form went through and the terminal event was delivered.', tone: 'good' }
    case 'failed': {
      const gloss = application.failureCode ? explainCode(application.failureCode) : null
      return {
        text: `Failed with ${application.failureCode ?? 'an unknown code'}.${gloss ? ` ${gloss}` : ''}`,
        tone: 'bad'
      }
    }
    case 'canceled':
      return { text: 'Canceled. A clean cancel is a valid outcome, not an error.', tone: 'neutral' }
    default:
      return { text: application.status, tone: 'neutral' }
  }
}

function countAnswers(event: WebhookEventRow): number {
  try {
    const command = JSON.parse(event.responseBody ?? '') as AnswerCommand
    return command.action === 'proceed' ? command.answers.length : 0
  } catch {
    return 0
  }
}

function Dot({
  state,
  terminal
}: {
  state: 'done' | 'current' | 'upcoming'
  terminal?: 'submitted' | 'failed' | 'canceled' | null
}) {
  if (state === 'done') {
    const tone =
      terminal === 'submitted'
        ? 'border-success-deep bg-success-deep'
        : terminal === 'failed'
          ? 'border-danger-deep bg-danger-deep'
          : 'border-ink-900 bg-ink-900'
    return (
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-white ${tone}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-3 w-3">
          <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    )
  }
  if (state === 'current') {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand bg-brand">
        <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
      </span>
    )
  }
  return <span className="h-6 w-6 shrink-0 rounded-full border hairline bg-white" />
}

export function StatusTimeline({
  application,
  events
}: {
  application: ApplicationRow
  events: WebhookEventRow[]
}) {
  const fields = latestFieldsEvent(events)

  let rank = STATUS_RANK[application.status] ?? 0
  // Seeing a callback proves the agent ran even if a status sync lagged.
  if (fields && rank < 3) rank = 3
  if (answeredProceed(fields) && rank < 4) rank = 4

  const isTerminal = STATUS_RANK[application.status] === 5
  const terminalKind = isTerminal ? (application.status as 'submitted' | 'failed' | 'canceled') : null

  const stages = [
    'created',
    'queued',
    'running',
    'awaiting answers',
    'answered',
    terminalKind ? terminalKind.replace(/_/g, ' ') : 'done'
  ]

  const line = statusLine(application, events, rank)
  const lineTones = {
    neutral: 'text-ink-600',
    good: 'text-success-deep',
    warn: 'bg-warning-tint px-3 py-2 text-warning-deep',
    bad: 'text-danger-deep'
  }

  return (
    <div className="panel p-6">
      {/* Six labels do not fit on one rail on a phone — "awaiting answers"
          alone is wider than its column — so below `sm` this stacks into a
          list with the label beside its dot, the same shape Stepper.tsx uses.
          The rail, with labels under the dots, returns at `sm`. */}
      <ol className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-0">
        {stages.map((stage, index) => {
          const state: 'done' | 'current' | 'upcoming' = isTerminal
            ? 'done'
            : index < rank
              ? 'done'
              : index === rank
                ? 'current'
                : 'upcoming'
          // Only color the final circle by outcome; earlier ones stay ink.
          const terminal = index === stages.length - 1 ? terminalKind : null

          return (
            <li
              key={stage}
              className={`flex items-center ${index > 0 ? 'sm:min-w-0 sm:flex-1' : ''}`}
            >
              {index > 0 && (
                <span className="mx-2 hidden h-px min-w-3 flex-1 bg-ink-200 sm:block" aria-hidden />
              )}
              <span className="flex items-center gap-2.5 sm:flex-col sm:gap-1.5">
                <Dot state={index === stages.length - 1 && isTerminal ? 'done' : state} terminal={terminal} />
                <span
                  className={`whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.05em] ${
                    state === 'upcoming' ? 'text-ink-400' : 'text-ink-600'
                  }`}
                >
                  {stage}
                </span>
              </span>
            </li>
          )
        })}
      </ol>
      <p className={`mt-4 text-sm leading-6 ${lineTones[line.tone]}`}>{line.text}</p>
    </div>
  )
}
