import type { ReactNode } from 'react'

/**
 * The tutorial's explainer aside. Mono uppercase eyebrow, short title, a few
 * sentences of prose. `tone="warn"` renders as a tint band (portal banner
 * style: tint fill, deep text, no border) for the rules that cost real
 * applications to learn the hard way.
 */
export function TeachPanel({
  eyebrow,
  title,
  tone = 'neutral',
  children
}: {
  eyebrow: string
  title: string
  tone?: 'neutral' | 'warn'
  children: ReactNode
}) {
  if (tone === 'warn') {
    return (
      <aside className="bg-warning-tint p-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-warning-deep/70">
          {eyebrow}
        </p>
        <h3 className="mt-1.5 text-sm font-semibold text-warning-deep">{title}</h3>
        <div className="mt-2 space-y-2 text-sm leading-6 text-warning-deep">{children}</div>
      </aside>
    )
  }

  return (
    <aside className="panel p-5">
      <p className="eyebrow text-[11px]">{eyebrow}</p>
      <h3 className="mt-1.5 text-sm font-semibold text-ink-900">{title}</h3>
      <div className="mt-2 space-y-2 text-sm leading-6 text-ink-600">{children}</div>
    </aside>
  )
}
