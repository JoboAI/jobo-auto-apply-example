'use client'

import { useState } from 'react'

/** The one client-side leaf inside CodeBlock. */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className="px-2 py-1 text-[11px] font-medium text-[#b3b3b3] transition-colors duration-150 ease-out hover:bg-white/10 hover:text-white"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}
