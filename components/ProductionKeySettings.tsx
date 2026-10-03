'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound } from 'lucide-react'
import { ApiKeyDialog } from './ApiKeyDialog'
import type { ModeProps } from './ModeToggle'

/** Settings-page panel: same dialog, plus status. */
export function ProductionKeySettings(props: ModeProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <section className="surface settings-card">
      <h2>Production mode</h2>
      <p className="subtle">
        {props.hasKey
          ? `Jobo API key ending ${props.keyHint} is connected. You are in ${props.mode} mode.`
          : 'Connect your own Jobo API key to search real jobs and apply to them.'}
      </p>
      <button type="button" className="button secondary" onClick={() => setOpen(true)}>
        <KeyRound size={15} /> {props.hasKey ? 'Manage API key' : 'Connect API key'}
      </button>
      <ApiKeyDialog
        {...props}
        open={open}
        onClose={() => setOpen(false)}
        onConnected={() => {
          setOpen(false)
          router.refresh()
        }}
      />
    </section>
  )
}
