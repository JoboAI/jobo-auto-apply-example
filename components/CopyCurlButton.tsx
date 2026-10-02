'use client'
import { useState } from 'react'
import { Check, Terminal } from 'lucide-react'

export function CopyCurlButton({ text, index }: { text: string; index: number }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="code-copy"
      aria-label={`Copy request ${index} as cURL`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        } catch {
          setCopied(false)
        }
      }}
    >
      {copied ? <Check size={13} /> : <Terminal size={13} />}
      {copied ? 'Copied' : 'Copy as cURL'}
    </button>
  )
}
