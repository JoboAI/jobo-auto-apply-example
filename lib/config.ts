import { z } from 'zod'

/**
 * Environment configuration, validated with zod. Every variable the app reads
 * is declared here except three that must work before the rest is valid:
 * DATABASE_URL / DATABASE_POOL_MAX (db/client.ts, also used by migrations) and
 * LOG_LEVEL (lib/logger.ts). .env.example lists them all.
 *
 *   config()      the Jobo, OpenRouter, storage and worker settings
 *   authConfig()  accounts and email (the web app only; the worker skips it)
 *
 * Validation is LAZY on purpose. `next build` evaluates modules, and a config
 * file that throws at import time turns a missing env var into an unreadable
 * build failure. Instead the
 * getters throw a precise error at the point of use, and the `*Issues()`
 * variants return the problems without throwing, which is what the health
 * check (app/api/health) and `npm run doctor` report.
 */

/**
 * Only needed to serve resume files. Jobo downloads a `file` field's URL from
 * its own infrastructure, and its SSRF guard only accepts an https origin on
 * port 443 that resolves to a public address. Encoding those rules here turns
 * the most common mistake — pointing this at http://localhost:3000 — into a
 * clear message rather than a silent `invalid_file` failure mid-application.
 */
const publicOrigin = z
  .string()
  .url()
  .superRefine((value, ctx) => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must be a valid URL',
      })
      return
    }
    if (url.protocol !== 'https:') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `must use https (got ${url.protocol.replace(':', '')}). Jobo rejects http file URLs.`,
      })
    }
    if (url.port && url.port !== '443') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `must be on port 443 (got :${url.port}). Jobo rejects any other port.`,
      })
    }
    if (url.pathname !== '/' && url.pathname !== '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `must be an origin with no path (got "${url.pathname}")`,
      })
    }
    if (/^(localhost|127\.|0\.0\.0\.0|\[?::1)/i.test(url.hostname)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'must be publicly resolvable — Jobo downloads resumes from its own infrastructure, so localhost can never work. Leave it unset to skip file fields instead.',
      })
    }
  })

const schema = z.object({
  JOBO_API_KEY: z
    .string()
    .min(1, 'required')
    .refine(
      (v) => v.startsWith('jbe_live_') || v.startsWith('jbe_test_'),
      'must start with jbe_live_ or jbe_test_ (master keys are rejected on Auto Apply routes)',
    ),
  JOBO_API_BASE_URL: z.string().url().default('https://connect.jobo.world'),

  /**
   * OPTIONAL. Turns on production mode, where a visitor connects their own
   * Jobo API key, browses real jobs and applies on that key. The key is
   * stored encrypted with this secret because the background worker needs it
   * after the browser has gone. Unset, the toggle says production mode is not
   * configured and the demo stays sandbox-only.
   */
  API_KEY_ENCRYPTION_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
  /** Public list of the ATSes Auto Apply can route to (no key needed). */
  JOBO_STATUS_URL: z
    .string()
    .url()
    .default('https://enterprise.jobo.world/api/v1/public/status/uptime'),

  /**
   * OPTIONAL. Everything in the synchronous loop works without a public
   * origin — the one thing that needs it is `file` fields, because Jobo
   * downloads the resume from a public HTTPS URL this app serves. When unset,
   * the answer engine skips file fields and records why in the trace.
   */
  PUBLIC_BASE_URL: publicOrigin.optional(),
  RESUME_URL_SIGNING_SECRET: z.string().min(32, 'must be at least 32 characters'),

  OPENROUTER_API_KEY: z.string().min(1, 'required'),
  OPENROUTER_ANSWER_MODEL: z.string().default('~deepseek/deepseek-v4-flash-latest'),
  OPENROUTER_RESUME_MODEL: z.string().default('deepseek/deepseek-v4-flash-0731'),
  OPENROUTER_APP_NAME: z.string().default('Jobo Auto Apply'),
  OPENROUTER_APP_URL: z.string().optional(),
  /**
   * How OpenRouter picks a host for the answer model. Unset, it routes by
   * price, and the cheapest DeepSeek hosts took 15-80 s on a 15-field form —
   * past the answer budget, which cancelled the application. `throughput`
   * held a steady ~23 s. `price` restores OpenRouter's default.
   */
  OPENROUTER_PROVIDER_SORT: z.enum(['throughput', 'latency', 'price']).default('throughput'),

  /**
   * Ceiling for the answer model call, in ms. The engine also shortens it to
   * fit the step's own answers_expire_at deadline.
   */
  ANSWER_BUDGET_MS: z.coerce.number().int().positive().default(90_000),

  /** postgres://user:password@host:port/database. */
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection URL'),
  /** Resume PDFs only. Jobo downloads them over HTTP for file fields. */
  DATA_DIR: z.string().default('./.data'),

  /** Applications run at once across all workers, and per candidate. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
  WORKER_USER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(1),
})

export type Config = z.infer<typeof schema>

let cached: Config | null = null

function raw() {
  return {
    JOBO_API_KEY: process.env.JOBO_API_KEY,
    JOBO_API_BASE_URL: process.env.JOBO_API_BASE_URL,
    API_KEY_ENCRYPTION_SECRET: process.env.API_KEY_ENCRYPTION_SECRET || undefined,
    JOBO_STATUS_URL: process.env.JOBO_STATUS_URL || undefined,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || undefined,
    RESUME_URL_SIGNING_SECRET: process.env.RESUME_URL_SIGNING_SECRET,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_ANSWER_MODEL: process.env.OPENROUTER_ANSWER_MODEL,
    OPENROUTER_RESUME_MODEL: process.env.OPENROUTER_RESUME_MODEL,
    OPENROUTER_APP_NAME: process.env.OPENROUTER_APP_NAME,
    OPENROUTER_APP_URL: process.env.OPENROUTER_APP_URL || undefined,
    OPENROUTER_PROVIDER_SORT: process.env.OPENROUTER_PROVIDER_SORT || undefined,
    DATABASE_URL: process.env.DATABASE_URL,
    ANSWER_BUDGET_MS: process.env.ANSWER_BUDGET_MS || undefined,
    DATA_DIR: process.env.DATA_DIR,
    WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY || undefined,
    WORKER_USER_CONCURRENCY: process.env.WORKER_USER_CONCURRENCY || undefined,
  }
}

/** Throws a readable aggregate error if anything is missing or malformed. */
export function config(): Config {
  return (cached ??= parseOrThrow(schema, raw()))
}

/**
 * Accounts (better-auth) and transactional email (Brevo). Separate from
 * config() so the worker, which sends no email and serves no sessions, does
 * not need these set.
 */
const authSchema = z.object({
  /** The app's own origin: account links in emails point here. */
  BETTER_AUTH_URL: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value)
      return (
        url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      )
    }, 'must be https (http is allowed only for localhost)'),
  BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  BREVO_API_KEY: z.string().min(1, 'required'),
  /** A sender address verified in your Brevo account. */
  AUTH_EMAIL_FROM: z.string().email('must be an email address'),
  /**
   * OPTIONAL. The request header that carries the real client IP, for
   * better-auth's rate limits. Set it ONLY when a proxy you control
   * overwrites that header on every request (for example nginx setting
   * X-Real-IP); otherwise any client could choose its own IP. Unset,
   * better-auth uses its default (X-Forwarded-For).
   */
  TRUSTED_IP_HEADER: z.string().optional(),
})

export type AuthConfig = z.infer<typeof authSchema>
let cachedAuth: AuthConfig | null = null

function rawAuth() {
  return {
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BREVO_API_KEY: process.env.BREVO_API_KEY,
    AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM,
    TRUSTED_IP_HEADER: process.env.TRUSTED_IP_HEADER || undefined,
  }
}

export function authConfig(): AuthConfig {
  return (cachedAuth ??= parseOrThrow(authSchema, rawAuth()))
}

export interface ConfigIssue {
  key: string
  message: string
}

/** Non-throwing variant of config(), for the health check and `npm run doctor`. */
export function configIssues(): ConfigIssue[] {
  return issues(schema, raw())
}

/** Non-throwing variant of authConfig(). */
export function authConfigIssues(): ConfigIssue[] {
  return issues(authSchema, rawAuth())
}

/** Every configured secret value, for redacting recorded API exchanges. */
export function secretValues(): string[] {
  const values = [
    process.env.JOBO_API_KEY,
    process.env.OPENROUTER_API_KEY,
    process.env.RESUME_URL_SIGNING_SECRET,
    process.env.API_KEY_ENCRYPTION_SECRET,
    process.env.BETTER_AUTH_SECRET,
    process.env.BREVO_API_KEY,
  ]
  return values.filter((value): value is string => !!value)
}

function parseOrThrow<T extends z.ZodTypeAny>(target: T, input: unknown): z.infer<T> {
  const parsed = target.safeParse(input)
  if (parsed.success) return parsed.data
  const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
  throw new Error(
    `Invalid environment configuration:\n${lines.join('\n')}\n\nCopy .env.example to .env.local and fill it in, then run \`npm run doctor\`.`,
  )
}

function issues(target: z.ZodTypeAny, input: unknown): ConfigIssue[] {
  const parsed = target.safeParse(input)
  if (parsed.success) return []
  return parsed.error.issues.map((i) => ({ key: String(i.path[0] ?? 'env'), message: i.message }))
}

/**
 * Absolute URL on our public origin, used for the resume URLs Jobo downloads.
 * Callers must check `config().PUBLIC_BASE_URL` first — the answer engine
 * skips file fields entirely when no public origin is configured.
 */
export function publicUrl(path: string): string {
  const origin = config().PUBLIC_BASE_URL
  if (!origin) {
    throw new Error('PUBLIC_BASE_URL is not set — file fields are skipped without a public origin.')
  }
  const base = origin.replace(/\/+$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}
