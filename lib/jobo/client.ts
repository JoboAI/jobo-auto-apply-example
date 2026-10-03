import { createClient, type JoboAutoApply } from '@jobo-ai/autoapply'
import { recordingFetch } from './recording-fetch'
import { config, secretValues } from '@/lib/config'

/**
 * The Auto Apply API client: `@jobo-ai/autoapply`, the published SDK. The
 * example does not hand-roll a client, and you should not need to either.
 *
 * The SDK's whole surface is `applications.create / get / list / cancel /
 * submitAnswers / run` plus the optional `mailboxes` resource. There is no
 * profile API, no resume upload and no webhook: the loop is synchronous, and
 * lib/application-engine.ts explains how this app drives it.
 *
 * The SDK retries network errors, 429, 502 and 503 on its own, and replays
 * create with the same Idempotency-Key, so a retry cannot produce a second
 * application.
 */

/**
 * A client for one application, or (without `applicationId`) for one-off
 * calls such as the preflight check.
 *
 * With `applicationId`, every HTTP exchange is recorded, redacted, for the
 * candidate's "API requests & responses" panel (lib/jobo/recording-fetch.ts).
 * `apiKey` overrides the deployment's key: production mode passes the
 * visitor's own key, so the application belongs to their Jobo account.
 */
export function jobo(applicationId?: string, apiKey?: string): JoboAutoApply {
  const c = config()
  const key = apiKey ?? c.JOBO_API_KEY
  return createClient({
    apiKey: key,
    baseUrl: c.JOBO_API_BASE_URL,
    ...(applicationId ? { fetch: recordingFetch(applicationId, [key, ...secretValues()]) } : {}),
  })
}
