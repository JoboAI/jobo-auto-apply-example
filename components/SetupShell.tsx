import type { ReactNode } from 'react'

/**
 * The wizard page shell — a port of the portal's SetupShell.vue.
 * Eyebrow → display title → description, with the stepper INSIDE the header
 * and a hairline below.
 *
 * The portal caps wizards at max-w-5xl because they are forms. This one is
 * mostly CODE — the tutorial's whole point is showing the bytes on the wire —
 * and at 1024px the snippets were 388px wide and scrolling horizontally with
 * 576px of window left empty. So it takes the full shell width.
 */
export function SetupShell({
  eyebrow,
  title,
  description,
  stepper,
  actions,
  children
}: {
  eyebrow: string
  title: string
  description: string
  stepper?: ReactNode
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
        {stepper && <div className="mt-8">{stepper}</div>}
      </header>
      {children}
    </div>
  )
}

/**
 * The recurring step layout: the thing you interact with, then the teaching
 * material under it. Keeping it a component keeps every step page consistent.
 *
 * This used to be a 3/2 split. Side-by-side sounds right for a tutorial, but
 * it cost the main column more than the rail gained: at a 1600px window the
 * code blocks rendered 388px wide and scrolled 1101px of content sideways.
 * Code is the substance here, so it gets the full width and the rail follows
 * underneath — where it also reads in the order you actually need it.
 */
export function StepColumns({ main, rail }: { main: ReactNode; rail: ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="space-y-6">{main}</div>
      <aside className="space-y-4">{rail}</aside>
    </div>
  )
}
