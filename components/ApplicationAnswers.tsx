import { Check, FileText } from 'lucide-react'
import type { StepRow } from '@/db/schema'
import { displayAnswer } from '@/lib/answer-display'
import { displayDate } from '@/lib/presentation'

const sources = {
  deterministic: 'Profile / exact match',
  llm: 'AI answer',
  repaired: 'Validation repair',
  previous_round: 'Previous answer',
  declined: 'Declined to answer',
  dropped: 'Omitted',
}

type Trace = NonNullable<StepRow['trace']>[number]

/**
 * What one step round answered and, just as important, what it did not. A
 * canceled round never stores a payload (a stored payload is replayed after a
 * restart), so its answers are read back from the trace instead.
 */
function stepRows(step: StepRow) {
  const traceById = new Map((step.trace ?? []).map((t) => [t.field_id, t]))
  const answered = step.answersJson?.length
    ? step.answersJson.map((a) => ({
        field_id: a.field_id,
        value: a.value,
        trace: traceById.get(a.field_id),
      }))
    : (step.trace ?? [])
        .filter((t) => t.value !== undefined && t.source !== 'dropped')
        .map((t) => ({ field_id: t.field_id, value: t.value, trace: t as Trace | undefined }))
  const answeredIds = new Set(answered.map((a) => a.field_id))
  const skipped: { field_id: string; label: string; reason: string }[] = (step.trace ?? [])
    .filter(
      (t) => !answeredIds.has(t.field_id) && (t.source === 'dropped' || t.source === 'declined'),
    )
    .map((t) => ({ field_id: t.field_id, label: t.label, reason: t.reason ?? sources[t.source] }))
  const explained = new Set([...answeredIds, ...skipped.map((s) => s.field_id)])
  for (const field of step.fieldsJson ?? []) {
    if (field.requires_answer && !explained.has(field.field_id))
      skipped.push({
        field_id: field.field_id,
        label: field.label,
        reason: 'Required, but neither the profile nor the AI produced an answer',
      })
  }
  return { answered, skipped }
}

export function ApplicationAnswers({ history }: { history: StepRow[] }) {
  const exchanges = history.filter(
    (step) => step.answersJson?.length || step.trace?.length || step.error,
  )
  const acceptedCount = exchanges
    .filter((step) => step.submittedAt)
    .reduce((sum, step) => sum + (step.answersJson?.length ?? 0), 0)
  return (
    <section className="surface application-answers" aria-labelledby="answers-sent-heading">
      <div className="spread">
        <h2 id="answers-sent-heading">
          <FileText size={21} /> Answers sent
        </h2>
        <span className="tag">{acceptedCount} accepted</span>
      </div>
      <p>
        Inspect the recorded answers for each API step. Corrections are kept separately and may
        replace earlier answers.
      </p>
      {!exchanges.length && (
        <div className="answers-empty">
          No answers have been sent yet. They’ll appear here when the worker prepares an application
          step.
        </div>
      )}
      {exchanges.map((step) => {
        const { answered, skipped } = stepRows(step)
        const fieldOf = (id: string) => step.fieldsJson?.find((field) => field.field_id === id)
        return (
          <details className="answer-exchange" key={`${step.stepId}-${step.correctionRound}`} open>
            <summary>
              <span>
                Step {step.sequence}
                {step.correctionRound > 0 ? ` · Correction ${step.correctionRound}` : ''}
              </span>
              <span className={step.submittedAt ? 'answer-accepted' : 'subtle'}>
                {step.submittedAt ? (
                  <>
                    <Check size={14} /> Accepted by API
                  </>
                ) : step.status === 'canceled' ? (
                  'Not sent — application stopped'
                ) : (
                  'Acceptance unconfirmed'
                )}
              </span>
            </summary>
            <div className="answer-exchange-meta">
              {step.submittedAt ? (
                <time>{displayDate(step.submittedAt)}</time>
              ) : (
                <span>
                  {step.status === 'canceled'
                    ? (step.error ?? 'Stopped before submitting.')
                    : 'Prepared payload — not confirmed accepted by the API.'}
                </span>
              )}
              {step.llmModel && (
                <span>
                  Model: {step.llmModel}
                  {step.llmMs !== null ? ` · ${(step.llmMs / 1000).toFixed(1)}s` : ''}
                </span>
              )}
              {step.submittedAt && step.error && (
                <span>AI step failed, profile answers sent: {step.error}</span>
              )}
            </div>
            <dl className="answer-values">
              {answered.map((answer) => {
                const field = fieldOf(answer.field_id)
                return (
                  <div className="answer-value" key={answer.field_id}>
                    <dt>
                      {field?.label ?? answer.field_id}
                      <code>{answer.field_id}</code>
                    </dt>
                    <dd>
                      <p>{displayAnswer(answer.value, field)}</p>
                      {answer.trace && <small>{sources[answer.trace.source]}</small>}
                    </dd>
                  </div>
                )
              })}
              {skipped.map((entry) => (
                <div className="answer-value answer-skipped" key={`skipped-${entry.field_id}`}>
                  <dt>
                    {fieldOf(entry.field_id)?.label ?? entry.label}
                    <code>{entry.field_id}</code>
                  </dt>
                  <dd>
                    <p>Not answered</p>
                    <small>{entry.reason}</small>
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        )
      })}
    </section>
  )
}
