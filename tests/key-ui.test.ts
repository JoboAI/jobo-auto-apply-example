import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AccessProblemNotice } from '@/components/AccessProblemNotice'
import { EnvironmentBadge } from '@/components/EnvironmentBadge'
import { accessProblem, createFailureMessage } from '@/lib/presentation'

/**
 * What the visitor sees about their key: the top-bar environment badge, and
 * the tailored message when Jobo refuses an application because the key's
 * account cannot use Auto Apply yet.
 */

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(element)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, '’')
    .replace(/\s+/g, ' ')
const markup = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(element)

describe('environment badge', () => {
  it('is a neutral Sandbox badge on a sandbox key, linking to the key settings', () => {
    const out = markup(createElement(EnvironmentBadge, { mode: 'sandbox', keyHint: 'abcd' }))
    expect(out).toContain('href="/settings#api-key"')
    expect(out).toContain('env-badge sandbox')
    expect(html(createElement(EnvironmentBadge, { mode: 'sandbox', keyHint: 'abcd' }))).toMatch(
      /Sandbox ···abcd/,
    )
  })
  it('warns on a production key: real employers', () => {
    const out = markup(createElement(EnvironmentBadge, { mode: 'production', keyHint: 'wxyz' }))
    expect(out).toContain('env-badge production')
    expect(out).toContain('href="/settings#api-key"')
    expect(out).toContain('Production — real employers')
  })
  it('asks for a key when none is connected', () => {
    const out = markup(createElement(EnvironmentBadge, { mode: null, keyHint: null }))
    expect(out).toContain('href="/onboarding"')
    expect(out).toContain('Connect API key')
  })
})

describe('Auto Apply access refusals', () => {
  const row = (overrides: Record<string, unknown>) => ({
    status: 'create_failed',
    createErrorCode: 'auto_apply_agreement_required',
    createErrorDetail: 'The Auto Apply agreement has not been accepted.',
    sandbox: false,
    ...overrides,
  })

  it.each([
    'auto_apply_not_enabled',
    'auto_apply_agreement_required',
    'auto_apply_review_required',
  ])('recognises %s as an access problem, with the API detail', (code) => {
    expect(accessProblem(row({ createErrorCode: code }))).toEqual({
      sandbox: false,
      detail: 'The Auto Apply agreement has not been accepted.',
    })
  })
  it('leaves other refusals and other statuses alone', () => {
    expect(accessProblem(row({ createErrorCode: 'unsupported_ats' }))).toBeNull()
    expect(accessProblem(row({ status: 'failed' }))).toBeNull()
  })

  it('tells a production key to switch to a sandbox key, with the way to do it', () => {
    const problem = accessProblem(row({}))!
    const text = html(createElement(AccessProblemNotice, { problem }))
    expect(text).toContain(
      'Your production key’s account can’t use Auto Apply yet: The Auto Apply agreement has not been accepted. Switch to a sandbox key to try the full flow.',
    )
    const out = markup(createElement(AccessProblemNotice, { problem }))
    expect(out).toMatch(
      /<a class="button primary small" href="\/settings#api-key">Use a sandbox key<\/a>/,
    )
    expect(out).toContain('href="https://enterprise.jobo.world/api-keys"')
    expect(out).toContain('Create a sandbox key in Jobo → API Keys')
    expect(createFailureMessage('auto_apply_agreement_required', problem)).toBe(
      'Your production key’s account can’t use Auto Apply yet: The Auto Apply agreement has not been accepted. Switch to a sandbox key to try the full flow.',
    )
  })

  it('shows a sandbox key the API detail and where access is handled', () => {
    const problem = accessProblem(row({ sandbox: true, createErrorDetail: 'Under review.' }))!
    const text = html(createElement(AccessProblemNotice, { problem }))
    expect(text).toContain('Jobo refused this sandbox application: Under review.')
    expect(text).not.toContain('Switch to a sandbox key')
    const out = markup(createElement(AccessProblemNotice, { problem }))
    expect(out).toContain('href="https://enterprise.jobo.world/auto-apply"')
    expect(out).toContain('href="https://enterprise.jobo.world/api-keys"')
    expect(out).not.toContain('Use a sandbox key')
  })

  it('still says something useful when the API sent no detail', () => {
    const problem = accessProblem(row({ createErrorDetail: null }))!
    expect(createFailureMessage('auto_apply_not_enabled', problem)).toMatch(
      /can’t use Auto Apply yet: Auto Apply is not enabled for its account\./,
    )
  })
})
