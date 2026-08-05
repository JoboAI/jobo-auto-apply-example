import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The README's sequence diagram is the first thing anyone sees on the public
 * repo, and a mermaid diagram that fails to parse renders as a wall of parser
 * error text instead of a picture.
 *
 * The failure that prompted this was a semicolon inside a `Note over` label.
 * Mermaid treats `;` as a statement separator, so it ended the note early and
 * then choked on the rest — reporting the error against the *following*
 * characters, which sent the search in the wrong direction. Nothing catches
 * this at build or test time; GitHub simply renders the error.
 */

const README = 'README.md'

function mermaidBlocks(): string[] {
  const source = readFileSync(README, 'utf8')
  return [...source.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((match) => match[1]!)
}

describe('README mermaid diagrams', () => {
  const blocks = mermaidBlocks()

  it('has at least one diagram to check', () => {
    expect(blocks.length).toBeGreaterThan(0)
  })

  it.each(blocks.map((block, i) => [i + 1, block] as const))(
    'block %i uses no semicolons (mermaid reads them as statement separators)',
    (_index, block) => {
      const offenders = block
        .split('\n')
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => line.includes(';'))
        .map(([n, line]) => `line ${n}: ${line.trim()}`)

      expect(offenders, `use <br/> or an em dash instead:\n${offenders.join('\n')}`).toEqual([])
    }
  )

  it.each(blocks.map((block, i) => [i + 1, block] as const))(
    'block %i declares a diagram type on its first line',
    (_index, block) => {
      const first = block.split('\n').find((line) => line.trim().length > 0) ?? ''
      expect(first.trim()).toMatch(
        /^(sequenceDiagram|flowchart|graph|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline)\b/
      )
    }
  )
})
