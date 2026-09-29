import { test, expect } from '@playwright/test'
import { join } from 'node:path'
test('account → resume → saved role → hands-free application, desktop and mobile', async ({
  page,
  context,
  request,
}) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: /Your app. Our API./ }),
  ).toBeVisible()
  await page.screenshot({
    path: 'test-results/landing-desktop.png',
    animations: 'disabled',
    fullPage: true,
  })
  await page
    .locator('.flow-visual')
    .screenshot({
      path: 'test-results/home-graphic-desktop.png',
      animations: 'disabled',
    })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: 'test-results/landing-mobile.png',
    animations: 'disabled',
    fullPage: true,
  })
  await page
    .locator('.flow-visual')
    .screenshot({
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
  await page
    .getByLabel('Password', { exact: true })
    .fill('browser-test-password-123')
  await page.getByRole('button', { name: 'Create your account' }).click()
  await expect(
    page.getByRole('heading', { name: 'Check your inbox.' }),
  ).toBeVisible()
  const messages = (await (
    await request.get('/__test__/mail')
  ).json()) as string[]
  const verification = messages
    .at(-1)!
    .split('\n')
    .find((s) => s.startsWith('http'))!
  await page.goto(verification)
  await expect(
    page.getByRole('heading', { name: 'Welcome, Alex.' }),
  ).toBeVisible()
  await page
    .locator('input[type=file]')
    .setInputFiles(join(process.cwd(), 'db/seed/ada-lovelace.pdf'))
  await expect(
    page.getByRole('heading', { name: 'Does this look like you?' }),
  ).toBeVisible()
  await expect(page.getByText('1 to complete', { exact: true })).toBeVisible()
  await page.getByLabel('LinkedIn profile').fill('https://example.com/in/alex')
  await page.getByRole('button', { name: 'Continue to application answers' }).click()
  await expect(page.locator('.inline-error[role="alert"]')).toContainText('Add a LinkedIn profile URL')
  await page.getByLabel('LinkedIn profile').fill('https://www.linkedin.com/in/jobo-test-candidate')
  await page.screenshot({ path: 'test-results/onboarding-contact-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: 'test-results/onboarding-contact-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Continue to application answers' }).click()
  await expect(page.getByRole('heading', { name: 'A few answers your resume may not have.' })).toBeVisible()
  await page.getByLabel('Countries you’re authorized to work in').fill('NL, DE')
  await page.getByLabel('Do you need visa sponsorship?').selectOption('false')
  await page.getByLabel('Self-identification preference').selectOption('leave_blank')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: 'test-results/onboarding-answers-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1440, height: 1050 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: 'test-results/onboarding-answers-desktop.png', fullPage: true })
  await page.getByRole('button', { name: 'Review extracted resume' }).click()
  await expect(page.getByRole('heading', { name: 'The facts behind every answer.' })).toBeVisible()
  // A reload restores saved answers. Unknown answers are still unknown, not false.
  await page.reload()
  await expect(page.getByLabel('LinkedIn profile')).toHaveValue('https://www.linkedin.com/in/jobo-test-candidate')
  await page.getByRole('button', { name: 'Continue to application answers' }).click()
  await expect(page.getByLabel('Countries you’re authorized to work in')).toHaveValue('NL, DE')
  await expect(page.getByLabel('Do you need visa sponsorship?')).toHaveValue('false')
  await expect(page.getByLabel('Self-identification preference')).toHaveValue('leave_blank')
  await page.getByRole('button', { name: 'Review extracted resume' }).click()
  await page.screenshot({ path: 'test-results/onboarding-review-desktop.png', fullPage: true })
  await page
    .getByRole('button', { name: 'Confirm profile & discover jobs' })
    .click()
  await expect(
    page.getByRole('heading', { name: 'See Auto Apply in action.' }),
  ).toBeVisible()
  await expect(
    page.getByText('Northwind Robotics', { exact: true }),
  ).toBeVisible()
  await page.screenshot({
    path: 'test-results/jobs-desktop.png',
    animations: 'disabled',
    fullPage: false,
  })
  await page.getByLabel('Search jobs').fill('Cascade')
  await expect(page.locator('.job-card')).toHaveCount(1)
  await page.getByRole('button', { name: 'Save job', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Unsave job' })).toBeVisible()
  await page.getByRole('link', { name: 'Saved jobs', exact: true }).click()
  await expect(page.locator('.job-card')).toHaveCount(1)
  await request.get('/__test__/worker/off')
  const savedCard = page.locator('.job-card')
  await savedCard
    .getByRole('button', { name: 'Apply with Auto Apply', exact: true })
    .click()
  await expect(page).toHaveURL(/\/saved$/)
  await expect(
    savedCard.getByRole('button', { name: 'Queued', exact: true }),
  ).toBeDisabled()
  await expect(savedCard.getByRole('status')).toContainText(
    'Saved to the queue',
  )
  const applicationPath = await savedCard
    .getByRole('link', { name: 'View application progress' })
    .getAttribute('href')
  await page.reload()
  await expect(
    savedCard.getByRole('button', { name: 'Queued', exact: true }),
  ).toBeDisabled()
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
    tracker
      .locator('.job-card')
      .getByRole('button', { name: 'Submitted', exact: true }),
  ).toBeVisible({ timeout: 30000 })
  await expect(tracker.locator('.job-card').getByRole('status')).toHaveText(
    'Submission confirmed by the API.',
  )
  const submittedButton = tracker
    .locator('.job-card')
    .getByRole('button', { name: 'Submitted', exact: true })
  await submittedButton.hover()
  await expect(submittedButton).toHaveCSS(
    'background-color',
    'rgb(196, 233, 207)',
  )
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
  await expect(
    tracker.getByText('Submission confirmed', { exact: true }),
  ).toBeVisible({ timeout: 30000 })
  await tracker.screenshot({
    path: 'test-results/application-desktop.png',
    animations: 'disabled',
    fullPage: true,
  })
  await tracker.getByRole('link', { name: 'All applications' }).click()
  await expect(tracker.locator('.application-row')).toHaveCount(1)
  await tracker.setViewportSize({ width: 390, height: 844 })
  await tracker
    .getByRole('link', { name: 'Discover jobs', exact: true })
    .click()
  await expect(
    tracker.getByRole('heading', { name: 'See Auto Apply in action.' }),
  ).toBeVisible()
  expect(
    await tracker.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await tracker.screenshot({
    path: 'test-results/jobs-mobile.png',
    animations: 'disabled',
    fullPage: false,
  })
  // A canceled card exposes an explicit retry; progress survives navigation.
  await tracker.getByLabel('Search jobs').fill('Northwind')
  const mobileCard = tracker.locator('.job-card')
  await request.get('/__test__/worker/off')
  await mobileCard
    .getByRole('button', { name: 'Apply with Auto Apply', exact: true })
    .click()
  await expect(
    mobileCard.getByRole('button', { name: 'Queued', exact: true }),
  ).toBeDisabled()
  await mobileCard.scrollIntoViewIfNeeded()
  await tracker.screenshot({
    path: 'test-results/card-queued-mobile.png',
    animations: 'disabled',
    fullPage: false,
  })
  await mobileCard
    .getByRole('link', { name: 'View application progress' })
    .click()
  await tracker
    .getByRole('button', { name: 'Cancel application', exact: true })
    .click()
  await request.get('/__test__/worker/on')
  await expect(tracker.locator('.status-badge')).toHaveText('Canceled', {
    timeout: 30000,
  })
  await tracker
    .getByRole('link', { name: 'Discover jobs', exact: true })
    .click()
  await tracker.getByLabel('Search jobs').fill('Northwind')
  await expect(
    mobileCard.getByRole('button', {
      name: 'Retry with Auto Apply',
      exact: true,
    }),
  ).toBeVisible()
  await mobileCard
    .getByRole('button', { name: 'Retry with Auto Apply', exact: true })
    .click()
  await expect(
    mobileCard.getByRole('button', { name: 'Submitted', exact: true }),
  ).toBeVisible({ timeout: 30000 })
  await mobileCard.scrollIntoViewIfNeeded()
  await tracker.screenshot({
    path: 'test-results/card-submitted-mobile.png',
    animations: 'disabled',
    fullPage: false,
  })
  await tracker.getByRole('link', { name: 'My profile', exact: true }).click()
  await expect(
    tracker.getByRole('heading', { name: 'Your test profiles.' }),
  ).toBeVisible()
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
  await stranger.close()
  await tracker
    .getByRole('link', { name: 'Account settings', exact: true })
    .click()
  await expect(
    tracker.getByRole('heading', { name: 'Account settings.' }),
  ).toBeVisible()
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
  await tracker.getByRole('button', { name: 'Log out', exact: true }).click()
  await expect(
    tracker.getByRole('heading', { name: /Your app. Our API./ }),
  ).toBeVisible()
})
