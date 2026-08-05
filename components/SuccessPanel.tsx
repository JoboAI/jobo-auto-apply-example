import type { ReactNode } from 'react'

/**
 * The completion band — a port of the portal's OnboardingSuccess: a full
 * success-tint surface (no border, per the banner rule) with an eyebrow,
 * display title, deep-green body, and an actions row over a soft divider.
 */
export function SuccessPanel({
  eyebrow,
  title,
  children,
  actions
}: {
  eyebrow: string
  title: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className="bg-success-tint p-6 sm:p-8">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-success/20 text-success-deep">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-5 w-5">
          <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.05em] text-success-deep/70">
        {eyebrow}
      </p>
      <h1 className="mt-1 font-display text-2xl font-medium tracking-[-0.01em] text-ink-900 md:text-3xl">
        {title}
      </h1>
      <div className="mt-2 max-w-2xl text-sm leading-6 text-success-deep">{children}</div>
      {actions && (
        <div className="mt-6 flex flex-wrap gap-3 border-t border-success/30 pt-5">{actions}</div>
      )}
    </section>
  )
}
