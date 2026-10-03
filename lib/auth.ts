import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '@/db/client'
import { user, session, account, verification } from '@/db/schema'
import { authConfig } from '@/lib/config'

/**
 * Candidate accounts, with better-auth: email + password, mandatory email
 * verification, password reset, sessions and rate limits. Its tables live in
 * db/schema.ts and requests reach it through app/api/auth/[...all].
 *
 * Account emails go out through Brevo's transactional API. To use another
 * provider, replace sendAccountEmail; nothing else depends on Brevo.
 */

export async function sendAccountEmail(email: string, url: string, kind: 'verify' | 'reset') {
  const subject = kind === 'verify' ? 'Verify your Jobo email' : 'Reset your Jobo password'
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      'api-key': authConfig().BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: {
        name: 'Jobo',
        email: authConfig().AUTH_EMAIL_FROM,
      },
      to: [{ email }],
      subject,
      textContent: `${subject}\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
    }),
  })
  if (!response.ok) throw new Error('Account email could not be sent. Please try again shortly.')
}

function createAuth() {
  const env = authConfig()
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    // See TRUSTED_IP_HEADER in lib/config.ts before setting it.
    ...(env.TRUSTED_IP_HEADER
      ? { advanced: { ipAddress: { ipAddressHeaders: [env.TRUSTED_IP_HEADER] } } }
      : {}),
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user, session, account, verification },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => sendAccountEmail(user.email, url, 'reset'),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => sendAccountEmail(user.email, url, 'verify'),
    },
    rateLimit: { enabled: true, window: 60, max: 20 },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  })
}
let instance: ReturnType<typeof createAuth> | undefined
export function auth() {
  return (instance ??= createAuth())
}
