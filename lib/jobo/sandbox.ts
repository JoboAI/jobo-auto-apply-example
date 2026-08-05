/**
 * Sandbox catalogue types.
 *
 * Everything else this app knows about the Auto Apply wire format comes from
 * `@jobo-ai/autoapply` — these live here only because the anonymous sandbox
 * endpoint sits outside the application lifecycle the SDK models.
 */

export interface SandboxScenario {
  slug: string
  name: string
  description: string | null
  apply_url: string | null
}

export interface SandboxScenariosResponse {
  api_version: string
  available: boolean
  token_url: string | null
  token_lifetime_minutes: number | null
  quota_per_hour: number | null
  retention_hours: number | null
  scenarios: SandboxScenario[]
}
