import 'server-only'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Read a code snippet out of a REAL source file in this repo, at render time.
 *
 * The tutorial shows the code that actually runs, not a copy — so snippets can
 * never drift from the implementation. This works because the example always
 * runs from its own repo directory (`next dev` / `next start`), where the
 * sources are present.
 *
 * `from` and `to` are matched as substrings against whole lines. The slice is
 * inclusive of both anchor lines. Prefer comments as anchors — they survive
 * refactors better than code.
 */
export function readSnippet(
  relativePath: string,
  from: string,
  to: string,
  /** Extra lines to include after the `to` anchor (e.g. closing braces). */
  extraLines = 0
): string {
  let lines: string[]
  try {
    lines = readFileSync(join(process.cwd(), relativePath), 'utf8').split('\n')
  } catch {
    return `// ${relativePath} not readable in this environment`
  }

  const start = lines.findIndex((line) => line.includes(from))
  if (start === -1) return `// anchor not found in ${relativePath}: ${from}`

  const end = lines.findIndex((line, index) => index >= start && line.includes(to))
  const slice = lines.slice(start, end === -1 ? start + 20 : end + 1 + extraLines)

  // Strip the common leading indentation so nested code sits flush.
  const indents = slice
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0)
  const trim = indents.length ? Math.min(...indents) : 0

  return slice.map((line) => line.slice(trim)).join('\n')
}
