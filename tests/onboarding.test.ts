import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { SANDBOX_KEY } from '@/tests/support/jobs'

/**
 * The key step: a signed-in visitor connects their own Jobo API key before
 * anything else, and one without a key (a new signup, or an existing account
 * from before keys were per visitor) is routed there.
 */

const identity = vi.hoisted(() => ({ id: 'erin' }))
vi.mock('@/lib/session', () => ({
  requireUser: async () => ({ id: identity.id, name: 'Erin Example', email: 'erin@example.com' }),
  currentUser: async () => ({ id: identity.id, name: 'Erin Example', email: 'erin@example.com' }),
}))
vi.mock('next/navigation', async (original) => ({
  ...(await original<typeof import('next/navigation')>()),
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`)
  },
  // Rendered outside a mounted app router (the resume step's upload button).
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}))

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'jobo-onboarding-'))
process.env.OPENROUTER_API_KEY = 'fixture'
process.env.RESUME_URL_SIGNING_SECRET = 'fixture-signing-secret-with-32-characters'
process.env.API_KEY_ENCRYPTION_SECRET = 'fixture-encryption-secret-with-32-characters'

let db: typeof import('@/db/client').db

beforeAll(async () => {
  ;({ db } = await import('@/db/client'))
  const { seedSampleProfiles } = await import('@/tests/support/seed')
  const { RESUME_DIR } = await import('@/db/client')
  await seedSampleProfiles(db, RESUME_DIR, 'erin')
})

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

async function landing(): Promise<string> {
  const { default: Home } = await import('@/app/page')
  try {
    await Home()
  } catch (error) {
    return (error as Error).message
  }
  return 'no redirect'
}

async function onboarding(): Promise<string> {
  const { default: Page } = await import('@/app/(product)/onboarding/page')
  return renderToStaticMarkup(await Page())
}

describe('the API key step', () => {
  it('sends a visitor with a profile but no key to onboarding, where the key comes first', async () => {
    expect(await landing()).toBe('redirect /onboarding')
    const page = await onboarding()
    expect(text(page)).toContain('Connect your Jobo API key')
    expect(page).toMatch(/<li class="current"><span>1<\/span>Connect your Jobo API key<\/li>/)
    expect(page).toContain('href="https://enterprise.jobo.world/api-keys"')
    expect(page).toContain('name="apiKey"')
  })

  it('shows the feed’s connect prompt instead of jobs while there is no key', async () => {
    const { FeedPage } = await import('@/lib/feed-page')
    const page = renderToStaticMarkup(await FeedPage({}))
    expect(text(page)).toContain('Connect your Jobo API key.')
    expect(page).toContain('href="/onboarding"')
  })

  it('moves on once a key is connected: the resume step, or the jobs when there is a profile', async () => {
    const { connectApiKey } = await import('@/lib/user-settings')
    await connectApiKey('erin', SANDBOX_KEY, false)
    expect(await landing()).toBe('redirect /jobs')
    expect(await onboarding()).toMatch(/<li class="current"><span>2<\/span>Upload resume<\/li>/)
  })
})
