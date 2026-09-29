import { Check, FileText } from 'lucide-react'
import type { StepRow } from '@/db/schema'
import { displayAnswer } from '@/lib/answer-display'
import { displayDate } from '@/lib/presentation'

const sources = {
  deterministic: 'Profile / exact match', llm: 'AI answer', repaired: 'Validation repair',
  previous_round: 'Previous answer', declined: 'Declined to answer', dropped: 'Omitted',
}

export function ApplicationAnswers({ history }: { history: StepRow[] }) {
  const exchanges = history.filter(step => step.answersJson?.length)
  const acceptedCount = exchanges.filter(step => step.submittedAt).reduce((sum, step) => sum + (step.answersJson?.length ?? 0), 0)
  return (
    <section className="surface application-answers" aria-labelledby="answers-sent-heading">
      <div className="spread"><h2 id="answers-sent-heading"><FileText size={21} /> Answers sent</h2><span className="tag">{acceptedCount} accepted</span></div>
      <p>Inspect the recorded answers for each API step. Corrections are kept separately and may replace earlier answers.</p>
      {!exchanges.length && <div className="answers-empty">No answers have been sent yet. They’ll appear here when the worker prepares an application step.</div>}
      {exchanges.map(step => (
        <details className="answer-exchange" key={`${step.stepId}-${step.correctionRound}`} open>
          <summary>
            <span>Step {step.sequence}{step.correctionRound > 0 ? ` · Correction ${step.correctionRound}` : ''}</span>
            <span className={step.submittedAt ? 'answer-accepted' : 'subtle'}>
              {step.submittedAt ? <><Check size={14} /> Accepted by API</> : 'Acceptance unconfirmed'}
            </span>
          </summary>
          <div className="answer-exchange-meta">
            {step.submittedAt ? <time>{displayDate(step.submittedAt)}</time> : <span>Prepared payload — not confirmed accepted by the API.</span>}
            {step.llmModel && <span>Model: {step.llmModel}{step.llmMs !== null ? ` · ${(step.llmMs / 1000).toFixed(1)}s` : ''}</span>}
          </div>
          <dl className="answer-values">
            {step.answersJson!.map(answer => {
              const field = step.fieldsJson?.find(field => field.field_id === answer.field_id)
              const trace = step.trace?.find(trace => trace.field_id === answer.field_id)
              return (
                <div className="answer-value" key={answer.field_id}>
                  <dt>{field?.label ?? answer.field_id}<code>{answer.field_id}</code></dt>
                  <dd><p>{displayAnswer(answer.value, field)}</p>{trace && <small>{sources[trace.source]}</small>}</dd>
                </div>
              )
            })}
          </dl>
        </details>
      ))}
    </section>
  )
}
