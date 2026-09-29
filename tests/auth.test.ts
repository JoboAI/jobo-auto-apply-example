import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'jobo-auth-'))
process.env.BETTER_AUTH_SECRET =
  'test-only-secret-that-is-at-least-32-characters'
process.env.BETTER_AUTH_URL = 'http://localhost:3333'
process.env.BREVO_API_KEY = 'test-only-brevo'
const messages: { to: { email: string }[]; textContent: string }[] = []
let auth: ReturnType<typeof import('@/lib/auth').auth>
const email = 'candidate@example.com',
  password = 'a-long-test-password'
async function request(path: string, body?: unknown, cookie?: string) {
  return auth.handler(
    new Request(`http://localhost:3333/api/auth/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3333',
        ...(cookie ? { cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  )
}
function lastLink() {
  return messages
    .at(-1)!
    .textContent.split('\n')
    .find((s) => s.startsWith('http'))!
}
let cookie = ''
beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options) => {
      if (String(url) !== 'https://api.brevo.com/v3/smtp/email')
        throw new Error('Unexpected network call')
      messages.push(JSON.parse(options.body))
      return Response.json({ messageId: 'test' })
    }),
  )
  auth = (await import('@/lib/auth')).auth()
})
afterAll(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
describe('real account lifecycle', () => {
  it('signs up without exposing a session before email verification', async () => {
    const r = await request('sign-up/email', {
      name: 'Candidate',
      email,
      password,
      callbackURL: '/jobs',
    })
    expect(r.status, await r.clone().text()).toBe(200)
    const body = await r.json()
    expect(body.token).toBeNull()
    expect(messages.at(-1)?.to[0].email).toBe(email)
    const login = await request('sign-in/email', { email, password })
    expect(login.status).toBe(403)
  })
  it('verifies the email and starts an authenticated session', async () => {
    const verify = await auth.handler(new Request(lastLink()))
    expect([200, 302]).toContain(verify.status)
    const login = await request('sign-in/email', { email, password })
    expect(login.status, await login.clone().text()).toBe(200)
    cookie = login.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; ')
    const session = await request('get-session', undefined, cookie)
    expect((await session.json()).user.email).toBe(email)
  })
  it('sends recovery email, resets password, and revokes old sessions', async () => {
    const reset = await request('request-password-reset', {
      email,
      redirectTo: 'http://localhost:3333/reset-password',
    })
    expect(reset.status, await reset.clone().text()).toBe(200)
    // Better Auth recovery emails point to its reset redirect endpoint.
    const redirect = await auth.handler(new Request(lastLink()))
    const token = new URL(redirect.headers.get('location')!).searchParams.get(
      'token',
    )
    expect(token).toBeTruthy()
    const update = await request('reset-password', {
      token,
      newPassword: 'another-long-password',
    })
    expect(update.status, await update.clone().text()).toBe(200)
    expect(
      await (await request('get-session', undefined, cookie)).json(),
    ).toBeNull()
    expect((await request('sign-in/email', { email, password })).status).toBe(
      401,
    )
    vi.setSystemTime(new Date(Date.now() + 15000))
    const login = await request('sign-in/email', {
      email,
      password: 'another-long-password',
    })
    expect(login.status).toBe(200)
    cookie = login.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; ')
  })
  it('logs out and rejects expired or forged sessions', async () => {
    expect((await request('sign-out', {}, cookie)).status).toBe(200)
    expect(
      await (await request('get-session', undefined, cookie)).json(),
    ).toBeNull()
    expect(
      await (
        await request(
          'get-session',
          undefined,
          'better-auth.session_token=forged',
        )
      ).json(),
    ).toBeNull()
  })
})
