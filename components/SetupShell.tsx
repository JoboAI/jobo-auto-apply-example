import type { ReactNode } from 'react'

/**
 * The tutorial page shell — a port of the portal's SetupShell.vue.
 * Eyebrow → display title → description, with a hairline below.
 *
 * The portal caps wizards at max-w-5xl because they are forms. This one is
 * mostly CODE — the notebook's whole point is showing the bytes on the wire —
 * and at 1024px the snippets were 388px wide and scrolling horizontally with
 * 576px of window left empty. So it takes the full shell width, and the
 * notebook cells stack in a single column for the same reason.
 */
export function SetupShell({
  eyebrow,
  title,
  description,
  actions,
  children
}: {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="w-full">
      <header className="mb-8 border-b hairline pb-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <p className="eyebrow">{eyebrow}</p>
            <h1 className="mt-2 font-display text-2xl font-medium tracking-[-0.01em] text-ink-900 md:text-3xl">
              {title}
            </h1>
            <p className="mt-2 text-sm leading-6 text-ink-600">{description}</p>
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      </header>
      {children}
    </div>
  )
}
