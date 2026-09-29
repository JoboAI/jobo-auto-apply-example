/**
 * Sandbox catalogue types.
 *
 * Everything else this app knows about the Auto Apply wire format comes from
 * `@jobo-ai/autoapply` — these live here only because the public sandbox catalog
 * sits outside the application lifecycle the SDK models.
 */

export interface SandboxScenario {
  slug: string
  name: string
  description: string | null
  apply_url: string | null
}

export interface SandboxScenariosResponse {
  available: boolean
  scenarios: SandboxScenario[]
}
