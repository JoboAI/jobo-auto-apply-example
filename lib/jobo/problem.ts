import { JoboAPIError } from '@jobo-ai/autoapply'

/**
 * Jobo returns `application/problem+json` (RFC 7807) for errors, with the
 * machine-readable code in `extensions.code` — i.e. flattened onto the body as
 * a top-level `code` key, alongside `api_version`.
 *
 * Parsing that is the SDK's job: it raises `JoboAPIError` with `.code`,
 * `.status`, `.detail` and `.retryAfterSeconds` already pulled apart. What
 * lives here is the part the SDK can't have an opinion on — plain-English copy
 * for the codes a user of *this* app can actually hit.
 *
 * Always branch on `code`, never on the human-readable `title`/`detail`.
 */
const EXPLANATIONS: Record<string, string> = {
  // Launch gate
  auto_apply_coming_soon:
    'Auto Apply is not enabled on this deployment yet. Application creation is gated off, so this call returns 503 until the gate is opened. Reading and canceling still work.',

  // Request shape
  idempotency_key_required:
    'Every create needs an Idempotency-Key header. This app generates and stores one before the request, so seeing this means the header was dropped in transit.',
  invalid_target: 'Provide exactly one of job_id or apply_url — not both, not neither.',
  job_not_found: 'No job with that id.',
  job_apply_url_missing: 'That job has no apply URL, so there is nothing to apply to.',

  // Idempotency
  idempotency_key_reuse:
    'That Idempotency-Key was already used with a different request body. Keys are bound to the exact body for 24 hours.',
  idempotency_key_in_flight:
    'A request with this Idempotency-Key is still being processed. Retry in a moment.',
  idempotency_result_unavailable:
    'The original result for this Idempotency-Key could not be replayed. Retry with the same key.',

  // Configuration
  ambiguous_ats: 'More than one ATS provider matched this URL, so Jobo will not guess.',
  unsupported_ats: 'No Auto Apply provider supports this ATS yet.',
  invalid_sandbox_target:
    'Sandbox mode requires a sandbox scenario URL. Pick one from the scenario list rather than typing a real job URL.',
  sandbox_job_id_forbidden: 'Sandbox applications cannot target a job_id — use apply_url.',
  sandbox_unavailable: 'The sandbox is not available on this deployment right now.',

  // Capacity
  application_quota_exceeded:
    'You have hit the create quota (5 live applications per 24 hours, 20 sandbox per hour).',
  application_capacity_exceeded:
    'Too many applications in flight. Jobo allows up to 200 queued or running applications per account.',
  concurrency_limit_reached:
    'You have reached your concurrent application limit. Cancel or submit an existing application before starting a new one — retrying will not help.',
  intake_paused: 'Application intake is temporarily paused.',
  provider_catalog_unavailable: 'The provider catalogue is briefly unavailable. Retry shortly.',

  // Lifecycle
  not_cancelable: 'This application already finished, so there is nothing to cancel.',
  invalid_status: 'Unknown status filter.',
  invalid_cursor:
    'A pagination cursor is bound to the filters it was created with. Restart pagination when filters change.',
  invalid_state:
    'The application is not awaiting answers right now — fetch it (the advance loop does) and act on the state that comes back.',
  stale_correction_round:
    'The answers were built for a different correction round than the one currently open. Re-fetch the current step and answer that instead.',
  validation_failed:
    'The answer snapshot failed synchronous validation. This is FREE — nothing was consumed and the step is still open. Fix the listed fields and submit again.',

  // Failure taxonomy (surfaced on the detail page)
  answers_timeout:
    'The step deadline (answers_expire_at, ~3 minutes) passed before answers were submitted. A real browser was holding the form open — answer faster, or check what stalled the engine.',
  verification_timeout:
    'A one-time verification code step expired. These allow only 60 seconds, because the emailed code itself is short-lived.',
  correction_limit_exceeded:
    'The employer ATS rejected the answers 3 times. Jobo stops after 3 correction rounds — check the step log to see which fields kept failing.',
  field_discovery_failed: 'Jobo could not read the application form on that page.',
  job_unavailable: 'The job posting is gone or no longer accepting applications.',
  unsupported_field: 'The form contains a field type Auto Apply cannot fill.',
  login_required: 'The form requires an authenticated session.',
  captcha_required: 'The form is protected by a CAPTCHA.',
  agent_unavailable: 'No browser session was available.',
  queue_timeout: 'The application waited too long for a browser session.',
  execution_timeout: 'The browser run exceeded its time budget.',
  submission_unconfirmed:
    'Jobo could not confirm the submission went through. Do NOT blindly retry — the form may have been submitted.',

  // Auth
  http_401: 'Authentication failed. Check JOBO_API_KEY — and note master keys are rejected here.',
  http_403: 'This key is not allowed to perform that action.',
  http_429: 'Rate limited. Back off and retry.'
}

/** Plain-English copy for an SDK error, falling back to the API's own detail. */
export function explain(error: unknown): string {
  if (error instanceof JoboAPIError) {
    return EXPLANATIONS[error.code] ?? error.detail ?? error.message
  }
  return error instanceof Error ? error.message : String(error)
}

export function explainCode(code: string): string | null {
  return EXPLANATIONS[code] ?? null
}
