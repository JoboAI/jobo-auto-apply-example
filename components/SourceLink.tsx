import { BookOpen, CodeXml } from 'lucide-react'

export function ApiDocsLink({ compact = false }: { compact?: boolean }) {
  return (
    <a
      className={`source-link${compact ? ' source-link-compact' : ''}`}
      href="https://jobo.world/docs/api-reference/auto-apply/auto-apply"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Auto Apply API documentation (opens in a new tab)"
    >
      <BookOpen size={16} aria-hidden="true" />
      <span>API documentation</span>
    </a>
  )
}

export function SourceLink({ compact = false }: { compact?: boolean }) {
  return (
    <a
      className={`source-link${compact ? ' source-link-compact' : ''}`}
      href="https://github.com/JoboAI/jobo-auto-apply-example"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="View source on GitHub (opens in a new tab)"
    >
      <CodeXml size={17} aria-hidden="true" />
      <span>View on GitHub</span>
    </a>
  )
}
