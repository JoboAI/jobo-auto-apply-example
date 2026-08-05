import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The tutorial renders code by slicing real source files between two anchor
 * strings, so what you read is always what runs. The failure mode is quiet:
 * `readSnippet` returns `// anchor not found in …` and the page still renders,
 * so a rename can gut the tutorial without breaking a build or a test.
 *
 * This walks every `readSnippet(...)` call in the tutorial and checks its
 * anchors still resolve, in order.
 */

const TUTORIAL = 'app/learn/[step]/page.tsx'

interface SnippetCall {
  path: string
  from: string
  to: string
}

function snippetCalls(): SnippetCall[] {
  const source = readFileSync(TUTORIAL, 'utf8')
  // Every call is `code={readSnippet(...)}`, so the argument list runs to the
  // first `)}`. Anchors use whichever quote does not appear inside them, and
  // there is an optional trailing number, so pull the arguments out as a block
  // and take the first three string literals of either quote style.
  const call = /readSnippet\(([\s\S]*?)\)\}/g
  const literal = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g

  const calls: SnippetCall[] = []
  for (const match of source.matchAll(call)) {
    const args = [...match[1]!.matchAll(literal)].map((m) => m[1] ?? m[2]!)
    if (args.length < 3) continue
    calls.push({ path: args[0]!, from: args[1]!, to: args[2]! })
  }
  return calls
}

describe('tutorial code snippets', () => {
  const calls = snippetCalls()

  it('finds every readSnippet call in the tutorial', () => {
    const occurrences = readFileSync(TUTORIAL, 'utf8').split('readSnippet(').length - 1
    expect(calls).toHaveLength(occurrences)
  })

  it.each(calls)('resolves $path between its anchors', ({ path, from, to }) => {
    const lines = readFileSync(path, 'utf8').split('\n')

    const start = lines.findIndex((line) => line.includes(from))
    expect(start, `missing "from" anchor in ${path}: ${from}`).toBeGreaterThanOrEqual(0)

    const end = lines.findIndex((line, index) => index >= start && line.includes(to))
    expect(end, `missing "to" anchor in ${path} after the "from" anchor: ${to}`).toBeGreaterThanOrEqual(
      start
    )
  })
})
