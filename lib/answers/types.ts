import type { Answer, CommandError, Field } from '@jobo-ai/autoapply'
import type { ResumeProfile } from '@/lib/resume/profile-schema'

/** Where an answer came from. Surfaced per-field in the step log UI. */
export type AnswerSource =
  | 'deterministic'
  | 'llm'
  | 'repaired'
  | 'previous_round'
  | 'dropped'
  | 'declined'

export interface AnswerTrace {
  field_id: string
  label: string
  type: string
  source: AnswerSource
  /** Which rule in lib/answers/deterministic.ts fired, when applicable. */
  rule?: string
  /** The model's own justification, when the LLM produced this. */
  reasoning?: string
  confidence?: number
  /** Set when a local repair changed the value before sending. */
  repaired_from?: unknown
  /** Set when we deliberately did not answer. */
  reason?: string
  value?: unknown
}

export interface AnswerContext {
  profile: ResumeProfile
  /**
   * Public HTTPS URL Jobo can download the resume from, or null when
   * PUBLIC_BASE_URL is not configured — file fields are then skipped with a
   * trace note instead of answered.
   */
  resumeUrl: string | null
  resumeFilename: string
  resumeContentType: string
  /** Raw resume text, as fallback context for open-ended questions. */
  resumeText: string
  applyUrl: string
  providerName?: string
  /** Errors from the previous correction round, if this is a retry. */
  commandErrors: CommandError[]
  correctionRound: number
  /** What we sent last round, so the retry prompt can say "don't repeat this". */
  previousAnswers: Answer[]
  /** Wall-clock milliseconds available for the LLM call. */
  budgetMs: number
}

export interface BuildResult {
  answers: Answer[]
  trace: AnswerTrace[]
  /** Fields we could not answer that Jobo requires — forces a cancel. */
  unanswerable: Field[]
  llmModel?: string
  llmMs?: number
  llmError?: string
}
