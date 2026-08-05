/**
 * Preflight CLI.
 *
 * The checks themselves live in lib/doctor-checks.ts and are shared with the
 * tutorial's "Run preflight" action (/learn/connect) — this file only loads
 * the env the way Next.js would and prints the results.
 *
 *   npm run doctor
 */

import { readFileSync } from 'node:fs'
import { configIssues } from '../lib/config'

loadEnv('.env.local')
loadEnv('.env')

function loadEnv(file: string) {
  let contents: string
  try {
    contents = readFileSync(file, 'utf8')
  } catch {
    return
  }
  for (const line of contents.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!match) continue
    const value = match[2].trim().replace(/^["'](.*)["']$/, '$1')
    if (process.env[match[1]] === undefined) process.env[match[1]] = value
  }
}

async function main() {
  console.log('\nJobo Auto Apply — preflight\n')

  const issues = configIssues()
  if (issues.length > 0) {
    for (const issue of issues) console.log(`✗ env ${issue.key} — ${issue.message}`)
    console.log('\nFix the environment first — the network checks depend on it.\n')
    process.exit(1)
  }
  console.log('✓ Environment — all variables present and well-formed')

  const { runPreflight } = await import('../lib/doctor-checks')
  const { callbackUrl } = await import('../lib/config')

  const results = await runPreflight()
  for (const result of results) {
    const icon = { pass: '✓', fail: '✗', warn: '!', info: 'i' }[result.status]
    console.log(`${icon} ${result.name} — ${result.detail}`)
  }

  const failed = results.filter((r) => r.status === 'fail').length
  const warned = results.filter((r) => r.status === 'warn').length
  console.log(
    `\n${failed === 0 ? 'Ready.' : `${failed} check${failed === 1 ? '' : 's'} failed.`}${
      warned ? ` ${warned} warning${warned === 1 ? '' : 's'}.` : ''
    }`
  )
  console.log(`Callback URL: ${callbackUrl()}\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
