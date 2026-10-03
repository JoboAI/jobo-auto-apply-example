'use client'
import { useEffect, useRef, useState } from 'react'

export interface DetailTab {
  id: string
  label: React.ReactNode
  content: React.ReactNode
}

/**
 * Tabs whose panels are all server-rendered: switching only toggles `hidden`.
 * The open tab lives in the URL hash (`#company`), written with
 * history.replaceState — never the Next router, whose soft navigations this
 * app avoids (see JobExplorer) — so a tab can be linked and survives reload.
 */
export function DetailTabs({ tabs, label }: { tabs: DetailTab[]; label: string }) {
  const [active, setActive] = useState(tabs[0]?.id)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1)
      if (tabs.some((t) => t.id === id)) setActive(id)
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
  }, [tabs])

  const select = (id: string, focus = false) => {
    setActive(id)
    const url = new URL(window.location.href)
    url.hash = id === tabs[0]?.id ? '' : id
    window.history.replaceState(window.history.state, '', url)
    if (focus) buttons.current[tabs.findIndex((t) => t.id === id)]?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (event.key === 'Home') select(tabs[0].id, true)
    else if (event.key === 'End') select(tabs[tabs.length - 1].id, true)
    else if (step) select(tabs[(index + step + tabs.length) % tabs.length].id, true)
    else return
    event.preventDefault()
  }

  return (
    <div className="detail-tabs">
      <div className="tabs detail-tab-bar" role="tablist" aria-label={label}>
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(el) => {
              buttons.current[i] = el
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-controls={`panel-${tab.id}`}
            aria-selected={active === tab.id}
            tabIndex={active === tab.id ? 0 : -1}
            className={active === tab.id ? 'selected' : ''}
            onClick={() => select(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`panel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          hidden={active !== tab.id}
          className="detail-tab-panel"
        >
          {tab.content}
        </div>
      ))}
    </div>
  )
}
