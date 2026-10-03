/**
 * Preflight: `npm run doctor`.
 *
 * Validates the environment (.env.local, or real environment variables), then
 * checks each service the app depends on. The checks live in
 * lib/doctor-checks.ts; this file loads the env and prints the results.
 */
import './load-env'
import { authConfigIssues, configIssues } from '../lib/config'
import { closeDb } from '../db/client'

console.log('\nJobo Auto Apply — preflight\n')

const issues = [...configIssues(), ...authConfigIssues()]
if (!process.env.DATABASE_URL) issues.push({ key: 'DATABASE_URL', message: 'required' })
if (issues.length > 0) {
  for (const issue of issues) console.log(`✗ env ${issue.key} — ${issue.message}`)
  console.log('\nFix the environment first: the service checks depend on it.\n')
  process.exit(1)
}
console.log('✓ Environment — all required variables present and well-formed')

const { runPreflight } = await import('../lib/doctor-checks')
const results = await runPreflight()
await closeDb()
for (const result of results) {
  const icon = { pass: '✓', fail: '✗', warn: '!', info: 'i' }[result.status]
  console.log(`${icon} ${result.name} — ${result.detail}`)
}

const failed = results.filter((r) => r.status === 'fail').length
const warned = results.filter((r) => r.status === 'warn').length
console.log(
  `\n${failed === 0 ? 'Ready.' : `${failed} check${failed === 1 ? '' : 's'} failed.`}${
    warned ? ` ${warned} warning${warned === 1 ? '' : 's'}.` : ''
  }\n`,
)
process.exit(failed === 0 ? 0 : 1)
