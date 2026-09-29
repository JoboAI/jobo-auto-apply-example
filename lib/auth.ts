import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '@/db/client'
import { user, session, account, verification } from '@/db/schema'

export function authConfigIssues(): string[] {
  const missing: string[] = []
  if (
    !process.env.BETTER_AUTH_SECRET ||
    process.env.BETTER_AUTH_SECRET.length < 32
  )
    missing.push('BETTER_AUTH_SECRET')
  try {
    const url = new URL(process.env.BETTER_AUTH_URL ?? '')
    if (
      url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      )
    )
      missing.push('BETTER_AUTH_URL')
  } catch {
    missing.push('BETTER_AUTH_URL')
  }
  if (!process.env.BREVO_API_KEY) missing.push('BREVO_API_KEY')
  return missing
}

export async function sendAccountEmail(
  email: string,
  url: string,
  kind: 'verify' | 'reset',
) {
  const subject =
    kind === 'verify' ? 'Verify your Jobo email' : 'Reset your Jobo password'
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      'api-key': process.env.BREVO_API_KEY ?? '',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: {
        name: 'Jobo',
        email: process.env.AUTH_EMAIL_FROM ?? 'noreply@jobo.world',
      },
      to: [{ email }],
      subject,
      textContent: `${subject}\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
    }),
  })
  if (!response.ok)
    throw new Error(
      'Account email could not be sent. Please try again shortly.',
    )
}

function createAuth() {
  if (authConfigIssues().length)
    throw new Error('Account service is not configured.')
  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    // The production nginx proxy overwrites X-Real-IP after resolving the
    // trusted Cloudflare address; clients cannot supply this header directly.
    advanced: { ipAddress: { ipAddressHeaders: ['x-real-ip'] } },
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: { user, session, account, verification },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) =>
        sendAccountEmail(user.email, url, 'reset'),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) =>
        sendAccountEmail(user.email, url, 'verify'),
    },
    rateLimit: { enabled: true, window: 60, max: 20 },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  })
}
let instance: ReturnType<typeof createAuth> | undefined
export function auth() {
  return (instance ??= createAuth())
}
