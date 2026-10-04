import { createClient, type JoboAutoApply } from '@jobo-ai/autoapply'
import { recordingFetch } from './recording-fetch'
import { config, secretValues } from '@/lib/config'
import type { JoboEnvironment } from './environment'

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
 * A client on one environment's key (lib/jobo/environment.ts).
 *
 * With `applicationId`, every HTTP exchange is recorded, redacted, for the
 * candidate's "API requests & responses" panel (lib/jobo/recording-fetch.ts).
 * Without it, the client is for one-off calls such as the preflight check.
 */
export function jobo(env: JoboEnvironment, applicationId?: string): JoboAutoApply {
  return createClient({
    apiKey: env.apiKey,
    baseUrl: config().JOBO_API_BASE_URL,
    ...(applicationId
      ? { fetch: recordingFetch(applicationId, [env.apiKey, ...secretValues()]) }
      : {}),
  })
}
