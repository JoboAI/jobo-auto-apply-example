import { codeToHtml } from 'shiki'
import { CopyButton } from './CopyButton'

/**
 * Dark code block — a port of the portal's CodeBlock.vue.
 *
 * shiki's github-dark theme with its background swapped to ink-950, under a
 * #141414 header band carrying a mono uppercase label and a copy button.
 * Rendered entirely on the server; the copy button is the only client leaf.
 */
export async function CodeBlock({
  code,
  language,
  label
}: {
  code: string
  language: string
  /** Header text — a file path (`lib/config.ts`) or a wire label (`POST /applications`). */
  label: string
}) {
  const html = await codeToHtml(code.trimEnd(), {
    lang: language,
    theme: 'github-dark',
    colorReplacements: { '#24292e': '#0d0d0d' }
  })

  return (
    <div className="overflow-hidden border hairline">
      <div className="flex items-center justify-between border-b border-white/10 bg-[#141414] px-3.5 py-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.05em] text-[#b3b3b3]">
          {label}
        </span>
        <CopyButton text={code} />
      </div>
      <div
        className="code-block-body text-[13px] leading-[1.6] [&_pre]:m-0 [&_pre]:overflow-x-auto [&_pre]:p-4 [&_pre]:font-mono"
        // shiki output is generated server-side from our own strings.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
