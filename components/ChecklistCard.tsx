import type { ReactNode } from 'react'
import { Panel } from './ui'

/**
 * Checklist rows in a panel — a port of the portal's PersonalizedNextSteps:
 * divide-y rows, a square brand-tint icon tile, title + description, and an
 * optional action on the right.
 */
export interface ChecklistItem {
  key: string
  title: string
  description: ReactNode
  /** ✓/✗/· states drive the tile color. */
  state?: 'done' | 'todo' | 'error'
  action?: ReactNode
}

function Tile({ state }: { state: ChecklistItem['state'] }) {
  if (state === 'done') {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center bg-success-tint text-success-deep">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-4 w-4">
          <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    )
  }
  if (state === 'error') {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center bg-danger-tint text-danger-deep">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-4 w-4">
          <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
        </svg>
      </div>
    )
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center bg-brand-tint text-brand">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[18px] w-[18px]">
        <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

export function ChecklistCard({
  title,
  description,
  items
}: {
  title: string
  description?: string
  items: ChecklistItem[]
}) {
  return (
    <Panel
      padding="none"
      title={
        <div>
          <h2 className="text-base font-semibold text-ink-900">{title}</h2>
          {description && <p className="mt-1 text-sm text-ink-600">{description}</p>}
        </div>
      }
    >
      <div className="divide-y hairline">
        {items.map((item) => (
          <div
            key={item.key}
            className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center"
          >
            <div className="flex min-w-0 flex-1 items-start gap-3.5">
              <Tile state={item.state} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-800">{item.title}</p>
                <div className="mt-1 text-sm leading-5 text-ink-600">{item.description}</div>
              </div>
            </div>
            {item.action && <div className="shrink-0">{item.action}</div>}
          </div>
        ))}
      </div>
    </Panel>
  )
}
