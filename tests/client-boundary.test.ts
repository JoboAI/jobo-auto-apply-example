import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * No browser bundle may contain server code. A client component that imports
 * lib/config, the database or the sealed-key helpers, even indirectly, would
 * ship secrets-handling code to the browser.
 *
 * The usual guard, the `server-only` package, throws under plain Node, and
 * the worker (a plain Node process) shares these modules with the web app.
 * So this test walks the import graph from every 'use client' file instead.
 * Type-only imports are erased at build time and do not count. Server
 * actions ('use server' files) are the one sanctioned bridge.
 */

const ROOT = resolve(__dirname, '..')
// Shared modules (zod schemas, formatting, URL state) are fine; these are not.
const SERVER_ONLY = [
  /^db\/(client|migrate)\.ts$/,
  /^lib\/(config|secret-box|user-settings|queue|application-engine|worker|auth|session|openrouter|signed-url|live-version|feed-page|doctor-checks)\.tsx?$/,
  /^lib\/jobo\/(client|environment|jobs-api|recording-fetch|supported-ats)\.ts$/,
  /^lib\/resume\/(extract|storage|structure)\.ts$/,
  /^lib\/answers\//,
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

function resolveImport(from: string, specifier: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = join(ROOT, specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(from, '..', specifier)
  else return null
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')])
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  return null
}

/** Value (non-type) imports of local modules. */
function valueImports(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const found: string[] = []
  for (const match of source.matchAll(
    /^import\s+(type\s+)?([\s\S]*?)\s*from\s+['"]([^'"]+)['"]/gm,
  )) {
    if (match[1]) continue
    const names = match[2]
    // `import { type A, type B } from …` is type-only too.
    if (
      /^\{[\s\S]*\}$/.test(names) &&
      names
        .slice(1, -1)
        .split(',')
        .every((n) => !n.trim() || /^\s*type\s/.test(n))
    )
      continue
    const target = resolveImport(file, match[3])
    if (target) found.push(target)
  }
  return found
}

function isServerOnly(file: string) {
  const path = relative(ROOT, file)
  return SERVER_ONLY.some((pattern) => pattern.test(path))
}

const clientFiles = ['app', 'components', 'lib']
  .flatMap((dir) => sourceFiles(join(ROOT, dir)))
  .filter((file) => /^\s*['"]use client['"]/.test(readFileSync(file, 'utf8')))

describe('client components', () => {
  it('finds the client components to check', () => {
    expect(clientFiles.length).toBeGreaterThan(10)
  })

  it.each(clientFiles.map((file) => [relative(ROOT, file), file]))(
    '%s reaches no server-only module',
    (_name, entry) => {
      const seen = new Set<string>()
      const queue: { file: string; path: string[] }[] = [{ file: entry, path: [] }]
      const violations: string[] = []
      while (queue.length) {
        const { file, path } = queue.shift()!
        if (seen.has(file)) continue
        seen.add(file)
        const source = readFileSync(file, 'utf8')
        // A server action is called over HTTP, not bundled.
        if (file !== entry && /^\s*['"]use server['"]/.test(source)) continue
        if (isServerOnly(file)) {
          violations.push([...path, relative(ROOT, file)].join(' → '))
          continue
        }
        for (const next of valueImports(file))
          queue.push({ file: next, path: [...path, relative(ROOT, file)] })
      }
      expect(violations).toEqual([])
    },
  )
})
