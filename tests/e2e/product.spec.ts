import { test, expect } from '@playwright/test'
import { join } from 'node:path'
test('account → resume → saved role → hands-free application, desktop and mobile', async ({
  page,
  context,
  request,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Your app. Our API./ })).toBeVisible()
  await page.screenshot({
    path: 'test-results/landing-desktop.png',
    animations: 'disabled',
    fullPage: true,
  })
  await page.locator('.flow-visual').screenshot({
    path: 'test-results/home-graphic-desktop.png',
    animations: 'disabled',
  })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({
    path: 'test-results/landing-mobile.png',
    animations: 'disabled',
    fullPage: true,
  })
  await page.locator('.flow-visual').screenshot({
    path: 'test-results/home-graphic-mobile.png',
    animations: 'disabled',
  })
  await page.setViewportSize({ width: 1440, height: 1050 })
  await page.getByRole('link', { name: 'Try Auto Apply' }).click()
  await page.getByLabel('Full name').focus()
  await expect(page.getByLabel('Full name')).toHaveCSS('outline-width', '3px')
  await page.screenshot({
    path: 'test-results/signup-desktop.png',
    animations: 'disabled',
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: 'test-results/signup-mobile.png',
    animations: 'disabled',
    fullPage: true,
  })
  await page.setViewportSize({ width: 1440, height: 1050 })
  await page.getByLabel('Full name').fill('Alex Morgan')
  await page.getByLabel('Email address').fill('alex.browser@example.com')
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password-123')
  await page.getByRole('button', { name: 'Create your account' }).click()
  await expect(page.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible()
  const messages = (await (await request.get('/__test__/mail')).json()) as string[]
  const verification = messages
    .at(-1)!
    .split('\n')
    .find((s) => s.startsWith('http'))!
  await page.goto(verification)
  await expect(page.getByRole('heading', { name: 'Welcome, Alex.' })).toBeVisible()
  await page
    .locator('input[type=file]')
    .setInputFiles(join(process.cwd(), 'tests/fixtures/ada-lovelace.pdf'))
  await expect(page.getByRole('heading', { name: 'Does this look like you?' })).toBeVisible()
  await expect(page.getByText('1 to complete', { exact: true })).toBeVisible()
  await page.getByLabel('LinkedIn profile').fill('https://example.com/in/alex')
  await page.getByRole('button', { name: 'Continue to employment info' }).click()
  await expect(page.locator('.inline-error[role="alert"]')).toContainText(
    'Add a LinkedIn profile URL',
  )
  await page.getByLabel('LinkedIn profile').fill('https://www.linkedin.com/in/jobo-test-candidate')
  await page.screenshot({ path: 'test-results/onboarding-contact-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: 'test-results/onboarding-contact-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Continue to employment info' }).click()
  await expect(page.getByRole('heading', { name: 'Where you can work.' })).toBeVisible()
  await page.getByLabel('Are you authorized to work in the US?').selectOption('false')
  await page.getByLabel('Are you authorized to work in Canada?').selectOption('false')
  await page.getByLabel('Are you authorized to work in the United Kingdom?').selectOption('true')
  await page.getByLabel('Also authorized to work in').fill('NL, DE')
  await page.getByLabel(/require sponsorship/).selectOption('false')
  // Every self-identification question must be answered; declining counts.
  await page.getByRole('button', { name: 'Continue to job preferences' }).click()
  await expect(page.locator('.inline-error[role="alert"]')).toContainText('gender option')
  await page.getByLabel(/^Gender/).selectOption('decline')
  await page.getByLabel('Are you a veteran?').selectOption('no')
  await page.getByLabel('Do you have a disability?').selectOption('decline')
  await page.getByLabel('Do you identify as LGBTQ+?').selectOption('decline')
  await page
    .getByRole('group', { name: /Ethnicity/ })
    .getByLabel('Decline to state')
    .check()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: 'test-results/onboarding-answers-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.setViewportSize({ width: 1440, height: 1050 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: 'test-results/onboarding-answers-desktop.png', fullPage: true })
  await page.getByRole('button', { name: 'Continue to job preferences' }).click()
  await expect(page.getByRole('heading', { name: 'What you’re looking for.' })).toBeVisible()
  await page.getByRole('group', { name: 'Work setup' }).getByLabel('Hybrid').check()
  await page.getByRole('button', { name: 'Continue to review & confirm' }).click()
  await expect(page.getByRole('heading', { name: 'The facts behind every answer.' })).toBeVisible()
  // A reload restores saved answers. Unknown answers are still unknown, not false.
  await page.reload()
  await expect(page.getByLabel('LinkedIn profile')).toHaveValue(
    'https://www.linkedin.com/in/jobo-test-candidate',
  )
  await page.getByRole('button', { name: 'Continue to employment info' }).click()
  await expect(page.getByLabel('Also authorized to work in')).toHaveValue('NL, DE')
  await expect(page.getByLabel(/require sponsorship/)).toHaveValue('false')
  await expect(page.getByLabel('Are you a veteran?')).toHaveValue('no')
  await expect(
    page.getByRole('group', { name: /Ethnicity/ }).getByLabel('Decline to state'),
  ).toBeChecked()
  await page.getByRole('button', { name: 'Continue to job preferences' }).click()
  await expect(page.getByRole('group', { name: 'Work setup' }).getByLabel('Hybrid')).toBeChecked()
  await page.getByRole('button', { name: 'Continue to review & confirm' }).click()
  await expect(page.getByRole('heading', { name: 'The facts behind every answer.' })).toBeVisible()
  await page.screenshot({ path: 'test-results/onboarding-review-desktop.png', fullPage: true })
  await page.getByRole('button', { name: 'Confirm profile & discover jobs' }).click()
  await expect(page.getByRole('heading', { name: 'See Auto Apply in action.' })).toBeVisible()
  await expect(page.getByText('Tidewater Games', { exact: true })).toBeVisible()
  await page.screenshot({
    path: 'test-results/jobs-desktop.png',
    animations: 'disabled',
    fullPage: false,
  })
  await page.getByLabel('Search jobs').fill('Data Engineer')
  await expect(page.locator('.job-card')).toHaveCount(1)
  await expect(
    page
      .locator('.job-card')
      .getByRole('link', { name: /View Data Engineer on sandbox.jobo.world/ }),
  ).toHaveAttribute('href', 'https://sandbox.jobo.world/apply/cascade-analytics-data-engineer')
  await page.getByRole('button', { name: 'Save job', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Unsave job' })).toBeVisible()
  await page.getByRole('link', { name: 'Saved jobs', exact: true }).click()
  await expect(page.locator('.job-card')).toHaveCount(1)
  await request.get('/__test__/worker/off')
  const savedCard = page.locator('.job-card')
  await savedCard.getByRole('button', { name: 'Apply with Auto Apply', exact: true }).click()
  await expect(page).toHaveURL(/\/saved$/)
  await expect(savedCard.getByRole('button', { name: 'Queued', exact: true })).toBeDisabled()
  await expect(savedCard.getByRole('status')).toContainText('Saved to the queue')
  const applicationPath = await savedCard
    .getByRole('link', { name: 'View application progress' })
    .getAttribute('href')
  await page.reload()
  await expect(savedCard.getByRole('button', { name: 'Queued', exact: true })).toBeDisabled()
  await page.screenshot({
    path: 'test-results/card-queued-desktop.png',
    animations: 'disabled',
    fullPage: false,
  })
  const applicationUrl = new URL(applicationPath!, page.url()).href
  await page.close()
  await request.get('/__test__/worker/on')
  const tracker = await context.newPage()
  await tracker.goto('/saved')
  await expect(
    tracker.locator('.job-card').getByRole('button', { name: 'Submitted', exact: true }),
  ).toBeVisible({ timeout: 30000 })
  await expect(tracker.locator('.job-card').getByRole('status')).toHaveText(
    'Submission confirmed by the API.',
  )
  const submittedButton = tracker
    .locator('.job-card')
    .getByRole('button', { name: 'Submitted', exact: true })
  await submittedButton.hover()
  await expect(submittedButton).toHaveCSS('background-color', 'rgb(196, 233, 207)')
  await expect(submittedButton).toHaveCSS('color', 'rgb(39, 91, 64)')
  await submittedButton.focus()
  await tracker.keyboard.press('Tab')
  await tracker.keyboard.press('Shift+Tab')
  await expect(submittedButton).toBeFocused()
  await expect(submittedButton).toHaveCSS('outline-width', '3px')
  await tracker.emulateMedia({ reducedMotion: 'reduce' })
  await submittedButton.hover()
  await expect(submittedButton).toHaveCSS('transform', 'none')
  await tracker.screenshot({
    path: 'test-results/card-submitted-desktop.png',
    animations: 'disabled',
    fullPage: false,
  })
  await tracker.emulateMedia({ reducedMotion: 'no-preference' })
  await submittedButton.click()
  await expect(tracker).toHaveURL(applicationUrl)
  await expect(tracker.getByText('Submission confirmed', { exact: true })).toBeVisible({
    timeout: 30000,
  })
  await tracker.getByRole('link', { name: 'View answers sent', exact: true }).click()
  const receipt = tracker.locator('.application-answers')
  await expect(receipt.getByRole('heading', { name: 'Answers sent' })).toBeVisible()
  await expect(receipt).toContainText('Full name')
  await expect(receipt).toContainText('Ada Lovelace')
  await expect(receipt).toContainText('Accepted by API')
  const apiPreview = tracker.locator('.api-preview')
  await apiPreview.locator(':scope > summary').click()
  await expect(apiPreview.locator('.api-exchange')).not.toHaveCount(0)
  await apiPreview.locator('.api-exchange > summary').first().click()
  await expect(apiPreview.getByRole('region', { name: 'Request 1', exact: true })).toContainText(
    '/api/auto-apply/applications',
  )
  await expect(apiPreview.getByRole('region', { name: 'Response 1', exact: true })).toContainText(
    'awaiting_answers',
  )
  await expect(apiPreview).not.toContainText('jbe_test_fixture')
  await expect(apiPreview).not.toContainText('fixture-openrouter')
  await expect(apiPreview.getByRole('button', { name: 'Copy request 1 as cURL' })).toBeVisible()
  await expect(apiPreview.getByRole('button', { name: 'Copy: Request 1 headers' })).toBeVisible()
  await apiPreview
    .locator('.api-exchange')
    .first()
    .screenshot({ path: 'test-results/api-exchange-desktop.png', animations: 'disabled' })
  await tracker.screenshot({
    path: 'test-results/application-desktop.png',
    animations: 'disabled',
    fullPage: true,
  })
  await tracker.setViewportSize({ width: 390, height: 844 })
  expect(
    await tracker.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true)
  await apiPreview.screenshot({
    path: 'test-results/api-preview-mobile.png',
    animations: 'disabled',
  })
  await tracker.setViewportSize({ width: 1440, height: 1050 })
  await tracker.getByRole('link', { name: 'All applications' }).click()
  await expect(tracker.locator('.application-row')).toHaveCount(1)
  await tracker.setViewportSize({ width: 390, height: 844 })
  await tracker.getByRole('link', { name: 'Discover jobs', exact: true }).click()
  await expect(tracker.getByRole('heading', { name: 'See Auto Apply in action.' })).toBeVisible()
  expect(
    await tracker.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true)
  await tracker.screenshot({
    path: 'test-results/jobs-mobile.png',
    animations: 'disabled',
    fullPage: false,
  })
  // A canceled card exposes an explicit retry; progress survives navigation.
  await tracker.getByLabel('Search jobs').fill('Senior Software Engineer')
  const mobileCard = tracker.locator('.job-card')
  await request.get('/__test__/worker/off')
  await mobileCard.getByRole('button', { name: 'Apply with Auto Apply', exact: true }).click()
  await expect(mobileCard.getByRole('button', { name: 'Queued', exact: true })).toBeDisabled()
  await mobileCard.scrollIntoViewIfNeeded()
  await tracker.screenshot({
    path: 'test-results/card-queued-mobile.png',
    animations: 'disabled',
    fullPage: false,
  })
  await mobileCard.getByRole('link', { name: 'View application progress' }).click()
  await tracker.getByRole('button', { name: 'Cancel application', exact: true }).click()
  await request.get('/__test__/worker/on')
  await expect(tracker.locator('.status-badge')).toHaveText('Canceled', {
    timeout: 30000,
  })
  await tracker.getByRole('link', { name: 'Discover jobs', exact: true }).click()
  await tracker.getByLabel('Search jobs').fill('Senior Software Engineer')
  await expect(
    mobileCard.getByRole('button', {
      name: 'Retry with Auto Apply',
      exact: true,
    }),
  ).toBeVisible()
  await mobileCard.getByRole('button', { name: 'Retry with Auto Apply', exact: true }).click()
  await expect(mobileCard.getByRole('button', { name: 'Submitted', exact: true })).toBeVisible({
    timeout: 30000,
  })
  await mobileCard.scrollIntoViewIfNeeded()
  await tracker.screenshot({
    path: 'test-results/card-submitted-mobile.png',
    animations: 'disabled',
    fullPage: false,
  })
  await tracker.getByRole('link', { name: 'My profile', exact: true }).click()
  await expect(tracker.getByRole('heading', { name: 'Your test profiles.' })).toBeVisible()
  await tracker.screenshot({
    path: 'test-results/profile-mobile.png',
    animations: 'disabled',
    fullPage: true,
  })
  await tracker.setViewportSize({ width: 1440, height: 1050 })
  await tracker.screenshot({
    path: 'test-results/profile-desktop.png',
    animations: 'disabled',
    fullPage: true,
  })
  await tracker.setViewportSize({ width: 390, height: 844 })
  const stranger = await context.browser()!.newContext()
  const strangerPage = await stranger.newPage()
  await strangerPage.goto(applicationUrl)
  await expect(strangerPage).toHaveURL(/\/login/)
  const signup = await stranger.request.post(
    new URL('/api/auth/sign-up/email', applicationUrl).href,
    {
      data: {
        name: 'Other Developer',
        email: 'other.browser@example.com',
        password: 'browser-other-password-123',
      },
      headers: { origin: 'http://127.0.0.1:3311' },
    },
  )
  expect(signup.ok()).toBe(true)
  const otherMail = (await (await request.get('/__test__/mail')).json()) as string[]
  await strangerPage.goto(
    otherMail
      .at(-1)!
      .split('\n')
      .find((s) => s.startsWith('http'))!,
  )
  await strangerPage.goto(applicationUrl)
  await expect(strangerPage.locator('.api-preview')).toHaveCount(0)
  await expect(strangerPage.locator('body')).not.toContainText('Ada Lovelace')
  await expect(strangerPage.getByRole('heading', { name: 'This page has moved on.' })).toBeVisible()
  await stranger.close()
  await tracker.getByRole('link', { name: 'Account settings', exact: true }).click()
  await expect(tracker.getByRole('heading', { name: 'Account settings.' })).toBeVisible()
  await tracker.screenshot({
    path: 'test-results/settings-mobile.png',
    animations: 'disabled',
    fullPage: true,
  })
  await tracker.setViewportSize({ width: 1440, height: 1050 })
  await tracker.screenshot({
    path: 'test-results/settings-desktop.png',
    animations: 'disabled',
    fullPage: true,
  })
  // Production mode: the visitor's own key, real (stubbed) jobs, real apply.
  await tracker.goto('/jobs')
  await tracker.getByRole('button', { name: 'Production', exact: true }).click()
  const dialog = tracker.getByRole('dialog')
  await expect(
    dialog.getByRole('heading', { name: 'Apply to real jobs with your API key' }),
  ).toBeVisible()
  const connect = dialog.getByRole('button', { name: 'Connect and switch' })
  await expect(connect).toBeDisabled()
  await dialog.getByLabel('I understand').check()
  await dialog.getByLabel('Jobo API key').fill('jbe_live_notTheRightKey000000_0000000000000000')
  await connect.click()
  await expect(dialog.getByRole('alert')).toContainText('rejected')
  await dialog
    .getByLabel('Jobo API key')
    .fill('jbe_live_e2eVisitorFixture0000_000000000000000000000000000000000000000')
  await tracker.screenshot({
    path: 'test-results/production-dialog-desktop.png',
    animations: 'disabled',
  })
  await connect.click()
  await expect(tracker.getByRole('heading', { name: 'Apply to real jobs.' })).toBeVisible()
  await expect(tracker.getByRole('button', { name: 'Production', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(tracker.locator('.job-card')).toHaveCount(2)
  await expect(tracker.locator('.workspace-label')).toHaveText('PRODUCTION MODE')
  // The explorer: facet counts and filters are the Jobs API's own.
  const explorer = tracker.getByRole('complementary', { name: 'Job filters' })
  await expect(explorer.getByRole('link', { name: 'Design, 1 job', exact: true })).toBeVisible()
  await explorer.getByRole('link', { name: 'Design, 1 job', exact: true }).click()
  await expect(tracker).toHaveURL(/ind=Design/)
  await expect(tracker.locator('.job-card')).toHaveCount(1)
  await expect(tracker.locator('.job-card')).toContainText('Initech')
  await tracker.getByRole('link', { name: 'Remove filter Design', exact: true }).click()
  await expect(tracker.locator('.job-card')).toHaveCount(2)
  await explorer.getByRole('link', { name: 'Exclude Design', exact: true }).click()
  await expect(tracker).toHaveURL(/ind=-Design/)
  await expect(tracker.locator('.job-card')).toHaveCount(1)
  await expect(tracker.locator('.job-card')).toContainText('Globex Systems')
  await expect(tracker.locator('.job-card')).toContainText('CA$150k–CA$190k/yr')
  await tracker.getByText('See the API call behind these results').click()
  await expect(tracker.getByLabel('Job search request body', { exact: true })).toContainText(
    '"exclude": [',
  )
  await tracker.screenshot({
    path: 'test-results/production-explorer-desktop.png',
    animations: 'disabled',
    fullPage: true,
  })
  await explorer.getByRole('link', { name: 'Clear all', exact: true }).click()
  await expect(tracker.locator('.job-card')).toHaveCount(2)
  // A company filter by domain shows the company Jobo resolved it to.
  await explorer.getByLabel('Company').fill('globex.example')
  await explorer.getByRole('button', { name: 'Only this', exact: true }).click()
  await expect(tracker.locator('.job-card')).toHaveCount(1)
  await expect(
    tracker.getByRole('link', { name: 'Remove filter Globex Systems', exact: true }),
  ).toBeVisible()
  // On a phone the filters fold behind one button and nothing scrolls sideways.
  await tracker.setViewportSize({ width: 390, height: 844 })
  const filtersButton = explorer.getByRole('button', { name: 'Filters (1)', exact: true })
  await expect(filtersButton).toBeVisible()
  await expect(explorer.getByLabel('Search jobs')).toBeHidden()
  await filtersButton.click()
  await expect(explorer.getByLabel('Search jobs')).toBeVisible()
  expect(
    await tracker.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true)
  await tracker.screenshot({
    path: 'test-results/production-explorer-mobile.png',
    animations: 'disabled',
    fullPage: true,
  })
  await tracker.setViewportSize({ width: 1440, height: 1050 })
  await tracker.goto('/jobs')
  await tracker.getByLabel('Search jobs').fill('platform')
  await tracker.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(tracker).toHaveURL(/q=platform/)
  const realCard = tracker.locator('.job-card')
  await expect(realCard).toHaveCount(1)
  await expect(
    realCard.getByRole('link', { name: /View Platform Engineer on jobs.lever.co/ }),
  ).toHaveAttribute('href', 'https://jobs.lever.co/globex/7c9e6679')
  await expect(realCard).toContainText('Auto Apply · Lever')
  await tracker.screenshot({
    path: 'test-results/production-jobs-desktop.png',
    animations: 'disabled',
  })
  await realCard.getByRole('button', { name: 'Apply with Auto Apply', exact: true }).click()
  await expect(realCard.getByRole('button', { name: 'Submitted', exact: true })).toBeVisible({
    timeout: 30000,
  })
  await realCard.getByRole('link', { name: 'Platform Engineer', exact: true }).click()
  await expect(tracker.getByText(/This is a real job on Lever/)).toBeVisible()
  // The job tab shows everything GET /api/jobs/{id} returned.
  const jobTab = tracker.getByRole('tabpanel', { name: 'Job details' })
  await expect(jobTab).toContainText('Home office budget')
  await expect(jobTab).toContainText('Oct 30, 2026')
  await expect(jobTab).toContainText('GLX-PLAT-118')
  await expect(jobTab).toContainText('Terraform')
  await expect(jobTab).toContainText('Montreal, QC, Canada')
  await expect(jobTab.getByRole('heading', { name: 'How we work' })).toBeVisible()
  await jobTab.getByText('See the raw API response for this job').click()
  await expect(jobTab.getByLabel('Job API response', { exact: true })).toContainText('"benefits"')
  // The apply card is the only thing in the side column: nothing scrolls under it.
  await expect(tracker.locator('.detail-layout > aside > *')).toHaveCount(1)
  await tracker.screenshot({
    path: 'test-results/production-job-tab-desktop.png',
    animations: 'disabled',
    fullPage: true,
  })
  // The free company profile, which search only summarises, is the other tab.
  await tracker.getByRole('tab', { name: 'About Globex Systems' }).click()
  await expect(tracker).toHaveURL(/#company$/)
  await expect(jobTab).toBeHidden()
  const company = tracker.getByRole('region', { name: 'About Globex Systems' })
  await expect(company.getByRole('link', { name: 'LinkedIn', exact: true })).toHaveAttribute(
    'href',
    'https://www.linkedin.com/company/globex-example',
  )
  await expect(company).toContainText('Hank Scorpio')
  await expect(company).toContainText('Glassdoor')
  await expect(company).toContainText('Hires through')
  await tracker.screenshot({
    path: 'test-results/production-company-tab-desktop.png',
    animations: 'disabled',
    fullPage: true,
  })
  // The open tab survives a reload.
  await tracker.reload()
  await expect(tracker.getByRole('region', { name: 'About Globex Systems' })).toBeVisible()
  await expect(company).toContainText('201-500 employees')
  await expect(company).toContainText('Series B')
  await expect(company).toContainText('Northwind Capital')
  await expect(company.getByRole('link', { name: /More jobs at Globex Systems/ })).toHaveAttribute(
    'href',
    '/jobs?co=0b8c3f4e-6d1a-4c2b-9e7f-5a4d3c2b1a09',
  )
  await tracker.setViewportSize({ width: 390, height: 844 })
  expect(
    await tracker.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true)
  await tracker.screenshot({
    path: 'test-results/production-job-mobile.png',
    animations: 'disabled',
  })
  // The toggle must not run into the logo on a phone.
  const brand = await tracker.locator('.mobile-brand').boundingBox()
  const toggle = await tracker.locator('.mode-toggle').boundingBox()
  expect(brand!.x + brand!.width).toBeLessThanOrEqual(toggle!.x)
  await tracker.setViewportSize({ width: 1440, height: 1050 })
  // With a key stored, switching is one click each way.
  await tracker.getByRole('button', { name: 'Sandbox', exact: true }).click()
  await expect(tracker.getByRole('heading', { name: 'See Auto Apply in action.' })).toBeVisible()
  await tracker.getByRole('button', { name: 'Production', exact: true }).click()
  await expect(tracker.getByRole('heading', { name: 'Apply to real jobs.' })).toBeVisible()
  await tracker.getByRole('button', { name: /Manage Jobo API key/ }).click()
  await tracker.getByRole('dialog').getByRole('button', { name: 'Disconnect key' }).click()
  await expect(tracker.getByRole('heading', { name: 'See Auto Apply in action.' })).toBeVisible()
  await expect(tracker.getByRole('button', { name: /Manage Jobo API key/ })).toHaveCount(0)
  await tracker.goto('/settings')
  await tracker.getByRole('button', { name: 'Log out', exact: true }).click()
  await expect(tracker.getByRole('heading', { name: /Your app. Our API./ })).toBeVisible()
})
