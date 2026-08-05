import { z } from 'zod'

/**
 * Environment configuration.
 *
 * Validation is LAZY on purpose. `next build` evaluates modules, and a config
 * file that throws at import time turns a missing env var into an unreadable
 * build failure. Instead:
 *
 *   - `config()`      throws a precise error, at the point of use
 *   - `configIssues()` returns problems without throwing, for the setup checklist
 *
 * That split is what lets the dashboard render a useful "here's what's missing"
 * page instead of a stack trace.
 */

/**
 * Jobo's SSRF guard only accepts an https origin on port 443 that resolves to a
 * public address. Encoding those rules here turns the single most common setup
 * mistake — pointing this at http://localhost:3000 — into a clear message
 * rather than a silent `unsafe_url` failure 30 seconds into an application.
 */
const publicOrigin = z
  .string()
  .url()
  .superRefine((value, ctx) => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be a valid URL' })
      return
    }
    if (url.protocol !== 'https:') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `must use https (got ${url.protocol.replace(':', '')}). Jobo rejects http callbacks.`
      })
    }
    if (url.port && url.port !== '443') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `must be on port 443 (got :${url.port}). Jobo rejects any other port, so a tunnel that exposes a custom port will not work.`
      })
    }
    if (url.pathname !== '/' && url.pathname !== '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `must be an origin with no path (got "${url.pathname}")`
      })
    }
    if (/^(localhost|127\.|0\.0\.0\.0|\[?::1)/i.test(url.hostname)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must be publicly resolvable — localhost will never receive a callback. Run `npm run tunnel`.'
      })
    }
  })

const schema = z.object({
  JOBO_API_KEY: z
    .string()
    .min(1, 'required')
    .refine(
      (v) => v.startsWith('jbe_live_') || v.startsWith('jbe_test_'),
      'must start with jbe_live_ or jbe_test_ (master keys are rejected on Auto Apply routes)'
    ),
  JOBO_API_BASE_URL: z.string().url().default('https://connect.jobo.world'),
  JOBO_WEBHOOK_SECRET: z
    .string()
    .min(1, 'required')
    .refine((v) => v.startsWith('whsec_'), 'must start with whsec_'),

  PUBLIC_BASE_URL: publicOrigin,
  RESUME_URL_SIGNING_SECRET: z.string().min(16, 'must be at least 16 characters'),

  OPENROUTER_API_KEY: z.string().min(1, 'required'),
  OPENROUTER_ANSWER_MODEL: z.string().default('google/gemini-2.0-flash'),
  OPENROUTER_RESUME_MODEL: z.string().default('openai/gpt-4o-mini'),
  OPENROUTER_APP_NAME: z.string().default('Jobo Auto Apply Example'),
  OPENROUTER_APP_URL: z.string().optional(),

  ANSWER_BUDGET_MS: z.coerce.number().int().positive().default(45_000),
  DATA_DIR: z.string().default('./.data'),
  DEFAULT_SANDBOX: z
    .string()
    .default('true')
    .transform((v) => v !== 'false')
})

export type Config = z.infer<typeof schema>

let cached: Config | null = null

function raw() {
  return {
    JOBO_API_KEY: process.env.JOBO_API_KEY,
    JOBO_API_BASE_URL: process.env.JOBO_API_BASE_URL,
    JOBO_WEBHOOK_SECRET: process.env.JOBO_WEBHOOK_SECRET,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
    RESUME_URL_SIGNING_SECRET: process.env.RESUME_URL_SIGNING_SECRET,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_ANSWER_MODEL: process.env.OPENROUTER_ANSWER_MODEL,
    OPENROUTER_RESUME_MODEL: process.env.OPENROUTER_RESUME_MODEL,
    OPENROUTER_APP_NAME: process.env.OPENROUTER_APP_NAME,
    OPENROUTER_APP_URL: process.env.OPENROUTER_APP_URL || undefined,
    ANSWER_BUDGET_MS: process.env.ANSWER_BUDGET_MS,
    DATA_DIR: process.env.DATA_DIR,
    DEFAULT_SANDBOX: process.env.DEFAULT_SANDBOX
  }
}

/** Throws a readable aggregate error if anything is missing or malformed. */
export function config(): Config {
  if (cached) return cached
  const parsed = schema.safeParse(raw())
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
    throw new Error(
      `Invalid environment configuration:\n${lines.join('\n')}\n\nCopy .env.example to .env.local and fill it in, then run \`npm run doctor\`.`
    )
  }
  cached = parsed.data
  return cached
}

export interface ConfigIssue {
  key: string
  message: string
}

/** Non-throwing variant, for the dashboard setup checklist and `npm run doctor`. */
export function configIssues(): ConfigIssue[] {
  const parsed = schema.safeParse(raw())
  if (parsed.success) return []
  return parsed.error.issues.map((i) => ({
    key: String(i.path[0] ?? 'env'),
    message: i.message
  }))
}


/** Absolute URL on our public origin. Used for callback and resume URLs. */
export function publicUrl(path: string): string {
  const base = config().PUBLIC_BASE_URL.replace(/\/+$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

export function callbackUrl(): string {
  return publicUrl('/api/jobo/webhook')
}
