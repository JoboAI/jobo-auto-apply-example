import type { ReactNode } from 'react'

/**
 * The wizard page shell — a port of the portal's SetupShell.vue.
 * Eyebrow → display title → description, with the stepper INSIDE the header,
 * a hairline below, and a narrower max width than regular pages (wizards are
 * max-w-5xl in the portal; content pages are 1264px).
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
    <div className="mx-auto w-full max-w-5xl">
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
 * The recurring step layout: interactive element left, teaching rail right,
 * stacked on mobile. Keeping it a component keeps every step page consistent.
 */
export function StepColumns({ main, rail }: { main: ReactNode; rail: ReactNode }) {
  return (
    <div className="grid gap-8 lg:grid-cols-5">
      <div className="space-y-6 lg:col-span-3">{main}</div>
      <aside className="space-y-4 lg:col-span-2">{rail}</aside>
    </div>
  )
}
