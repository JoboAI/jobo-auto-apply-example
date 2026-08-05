import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Presentational primitives, ported from the Jobo Enterprise portal design
 * system (Render-inspired: flat white, hairline borders, square corners,
 * near-black buttons that hover purple, deep-text-on-pale-tint status colors).
 */

// ─── Buttons ─────────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'
export type ButtonSize = 'sm' | 'md'

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 font-medium select-none ' +
  'transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:pointer-events-none'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // The signature move: near-black at rest, purple on hover, deep purple active.
  primary:
    'bg-ink-950 text-white hover:bg-brand active:bg-brand-deep disabled:bg-ink-100 disabled:text-ink-300',
  secondary:
    'border border-black/20 bg-transparent text-ink-900 hover:bg-ink-900 hover:text-white active:bg-black disabled:text-black/20',
  ghost:
    'bg-transparent text-ink-800 hover:bg-black/10 hover:text-ink-900 active:bg-black/20 disabled:text-ink-300',
  danger:
    'bg-danger-deep text-white hover:bg-[#63080E] active:bg-[#390508] disabled:bg-danger-tint disabled:text-[#F0989E]',
  link: 'bg-transparent text-brand px-0 hover:text-brand-deep hover:underline disabled:text-ink-300'
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] leading-[18px] tracking-[0.01em]',
  md: 'h-10 px-3 text-sm'
}

/** Class-string builder shared by server components and client forms. */
export function btn(variant: ButtonVariant = 'primary', size: ButtonSize = 'md'): string {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${variant === 'link' ? '' : BUTTON_SIZES[size]}`
}

export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  children
}: {
  href: string
  variant?: ButtonVariant
  size?: ButtonSize
  children: ReactNode
}) {
  return (
    <Link href={href} className={btn(variant, size)}>
      {children}
    </Link>
  )
}

// ─── Surfaces ────────────────────────────────────────────────────────────────

export function Panel({
  title,
  eyebrow,
  actions,
  children,
  padding = 'md',
  className = ''
}: {
  title?: ReactNode
  eyebrow?: string
  actions?: ReactNode
  children: ReactNode
  padding?: 'none' | 'md' | 'lg'
  className?: string
}) {
  const pad = padding === 'none' ? '' : padding === 'lg' ? 'p-8' : 'p-6'
  return (
    <section className={`panel ${className}`}>
      {(title || actions || eyebrow) && (
        <header className="flex items-center justify-between gap-4 border-b hairline px-6 py-4">
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {typeof title === 'string' ? (
              <h2 className="text-base font-semibold text-ink-900">{title}</h2>
            ) : (
              title
            )}
          </div>
          {actions}
        </header>
      )}
      <div className={pad}>{children}</div>
    </section>
  )
}

// ─── Status ──────────────────────────────────────────────────────────────────

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info'

/** Deep text on pale tint; the raw hue appears only in the dot. */
const TONES: Record<Tone, { badge: string; dot: string }> = {
  neutral: { badge: 'bg-ink-100 text-ink-800', dot: 'bg-ink-500' },
  good: { badge: 'bg-success-tint text-success-deep', dot: 'bg-success' },
  warn: { badge: 'bg-warning-tint text-warning-deep', dot: 'bg-warning' },
  bad: { badge: 'bg-danger-tint text-danger-deep', dot: 'bg-danger' },
  info: { badge: 'bg-brand-tint text-brand', dot: 'bg-brand' }
}

export function Badge({
  children,
  tone = 'neutral',
  dot = false
}: {
  children: ReactNode
  tone?: Tone
  dot?: boolean
}) {
  const styles = TONES[tone]
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium tracking-[0.01em] ${styles.badge}`}
    >
      {dot && <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${styles.dot}`} />}
      {children}
    </span>
  )
}

/** One shared status → tone map (running/awaiting = brand, per the portal). */
export function statusTone(status: string): Tone {
  switch (status) {
    case 'submitted':
      return 'good'
    case 'failed':
    case 'create_failed':
      return 'bad'
    case 'running':
    case 'awaiting_answers':
      return 'info'
    default:
      return 'neutral' // queued, creating, canceled
  }
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={statusTone(status)} dot>
      {status.replace(/_/g, ' ')}
    </Badge>
  )
}

// ─── Misc ────────────────────────────────────────────────────────────────────

export function Json({ value }: { value: unknown }) {
  return <pre className="code">{JSON.stringify(value, null, 2)}</pre>
}

/** Per the writing guide: "[Object] not found or not added yet. [Next step]." */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border border-dashed hairline bg-white px-8 py-8">
      <p className="text-[15px] font-semibold tracking-[-0.01em] text-ink-900">{title}</p>
      {children && <div className="mt-2 max-w-lg text-sm text-ink-600">{children}</div>}
    </div>
  )
}

export function relativeTime(ms: number | null | undefined): string {
  if (!ms) return '—'
  const delta = Date.now() - ms
  const seconds = Math.round(delta / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(ms).toLocaleDateString()
}
