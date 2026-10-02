'use client'
import { useState } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'

/**
 * The filter column. Always open on wide screens; on phones it folds behind a
 * "Filters" button so the results come first. The filters themselves are
 * server-rendered links and GET forms — nothing here talks to the router.
 */
export function ExplorerShell({
  active,
  children,
}: {
  active: number
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <aside className={`explorer ${open ? 'open' : ''}`} aria-label="Job filters">
      <button
        type="button"
        className="button secondary explorer-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X size={16} /> : <SlidersHorizontal size={16} />}
        {open ? 'Hide filters' : `Filters${active ? ` (${active})` : ''}`}
      </button>
      <div className="explorer-body">{children}</div>
    </aside>
  )
}
