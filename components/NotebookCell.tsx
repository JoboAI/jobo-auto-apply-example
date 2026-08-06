import type { ReactNode } from 'react'
import type { CellState } from '@/lib/tutorial'
import { Badge } from './ui'

/**
 * One notebook cell — the Colab metaphor in the Render visual language.
 *
 * A `.panel` with a header band (eyebrow + state badge), a mono execution
 * indicator in a hairline gutter (`[ ]` ready, `[*]` running, `[n]` done),
 * the cell body (code, then whatever it takes to run it), and an OUTPUT area
 * on ink-50 below. Locked cells stay fully visible but dimmed and inert, so
 * the whole notebook's shape reads up front — like an unexecuted notebook.
 */

const STATE_BADGE: Record<CellState, { tone: 'neutral' | 'good' | 'info'; dot: boolean }> = {
  locked: { tone: 'neutral', dot: false },
  ready: { tone: 'neutral', dot: false },
  running: { tone: 'info', dot: true },
  done: { tone: 'good', dot: true }
}

function Indicator({ index, state }: { index: number; state: CellState }) {
  const glyph = state === 'done' ? `[${index}]` : state === 'running' ? '[*]' : '[ ]'
  return (
    <div
      className={`flex flex-col items-center gap-2 pt-5 font-mono text-[13px] ${
        state === 'locked' ? 'text-ink-300' : 'text-ink-500'
      }`}
      aria-hidden
    >
      <span className="whitespace-pre">{glyph}</span>
      {state === 'running' && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
      )}
      {state === 'done' && <span className="h-1.5 w-1.5 rounded-full bg-success" />}
    </div>
  )
}

export function NotebookCell({
  index,
  title,
  state,
  lockedNote,
  children,
  output,
  footer
}: {
  index: number
  title: string
  state: CellState
  /** Badge text while locked, e.g. "waits on cell 1". */
  lockedNote?: string
  /** The cell body: code, plus whatever runs it. */
  children: ReactNode
  /** Output area content; omit to show the empty state. */
  output?: ReactNode
  /** Teaching material under the output (accordions, asides). */
  footer?: ReactNode
}) {
  const locked = state === 'locked'
  const badge = STATE_BADGE[state]

  return (
    <section className="panel" id={`cell-${index}`}>
      <header className="flex items-center justify-between gap-4 border-b hairline px-4 py-2.5 sm:px-5">
        <p className="eyebrow">
          Cell {index} · {title}
        </p>
        <Badge tone={badge.tone} dot={badge.dot}>
          {locked ? (lockedNote ?? 'locked') : state}
        </Badge>
      </header>

      <div className="flex">
        <div className="w-12 shrink-0 border-r hairline sm:w-14">
          <Indicator index={index} state={state} />
        </div>
        <div
          className={`min-w-0 flex-1 space-y-4 p-4 sm:p-5 ${
            locked ? 'pointer-events-none opacity-60 select-none' : ''
          }`}
          aria-disabled={locked || undefined}
        >
          {children}
        </div>
      </div>

      {!locked && (
        <div className="border-t hairline bg-ink-50 px-4 py-4 sm:px-5">
          <p className="eyebrow text-[11px]">Output</p>
          <div className="mt-2 space-y-4">
            {output ?? <p className="text-sm text-ink-500">Not run yet.</p>}
          </div>
        </div>
      )}

      {!locked && footer && (
        <div className="space-y-3 border-t hairline px-4 py-4 sm:px-5">{footer}</div>
      )}
    </section>
  )
}
