'use client'
import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/**
 * A labelled code panel with a one-click copy. `children` is the rendered
 * (possibly highlighted) code; `copy` is the exact text that goes on the
 * clipboard.
 */
export function CodeBlock({
  title,
  copy,
  copyLabel = 'Copy',
  note,
  label,
  children,
}: {
  title: string
  copy: string
  copyLabel?: string
  note?: string
  label: string
  children: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="code-block">
      <div className="code-block-head">
        <span>{title}</span>
        {note && <small>{note}</small>}
        <button
          type="button"
          className="code-copy"
          aria-label={`${copyLabel}: ${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(copy)
              setCopied(true)
              setTimeout(() => setCopied(false), 1600)
            } catch {
              setCopied(false)
            }
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied' : copyLabel}
        </button>
      </div>
      <pre tabIndex={0} aria-label={label}>
        <code>{children}</code>
      </pre>
    </div>
  )
}
