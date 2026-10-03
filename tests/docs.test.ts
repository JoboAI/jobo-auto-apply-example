import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The README and .env.example are the first thing a developer reads. These
 * checks keep them true as the code moves.
 */

const ROOT = resolve(__dirname, '..')
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
const envExample = readFileSync(join(ROOT, '.env.example'), 'utf8')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

describe('README', () => {
  it('links only to files that exist', () => {
    const links = [...readme.matchAll(/\]\(((?!https?:|#|mailto:)[^)\s]+)\)/g)].map((m) => m[1])
    expect(links.length).toBeGreaterThan(20)
    expect(links.filter((link) => !existsSync(join(ROOT, link)))).toEqual([])
  })

  it('keeps Mermaid labels free of semicolons, which GitHub reads as statement breaks', () => {
    const diagrams = [...readme.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1])
    expect(diagrams.length).toBeGreaterThan(0)
    for (const diagram of diagrams) expect(diagram).not.toContain(';')
  })
})

describe('environment variables', () => {
  const used = new Set(
    ['app', 'lib', 'db', 'scripts']
      .flatMap((dir) => sourceFiles(join(ROOT, dir)))
      .flatMap((file) => [
        ...readFileSync(file, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g),
      ])
      .map((m) => m[1])
      .filter((name) => name !== 'NODE_ENV'),
  )

  it.each([...used])('%s is in .env.example and the README', (name) => {
    expect(envExample).toMatch(new RegExp(`^#? ?${name}=`, 'm'))
    expect(readme).toContain(`\`${name}\``)
  })
})
