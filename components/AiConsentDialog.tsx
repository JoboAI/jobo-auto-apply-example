'use client'
import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { AI_CONSENT_CHECKBOX, AI_CONSENT_POINTS, AI_CONSENT_TITLE } from '@/lib/ai-consent'

/**
 * The one-time "AI writes your answers and can make mistakes" acknowledgement,
 * shown when the server refuses a first application without it. The box starts
 * unticked: the Auto Apply Terms need an explicit, affirmative choice.
 */
export function AiConsentDialog({
  open,
  onAccept,
  onClose,
}: {
  open: boolean
  onAccept: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [agreed, setAgreed] = useState(false)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      setAgreed(false)
      dialog.showModal()
    } else if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className="consent-dialog"
      aria-labelledby="ai-consent-title"
      onClose={onClose}
    >
      <h2 id="ai-consent-title">
        <Sparkles size={18} /> {AI_CONSENT_TITLE}
      </h2>
      <ul className="responsibilities">
        {AI_CONSENT_POINTS.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <label className="consent-dialog-check">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        {AI_CONSENT_CHECKBOX}
      </label>
      <div className="consent-dialog-actions">
        <button type="button" className="button secondary" onClick={onClose}>
          Not now
        </button>
        <button type="button" className="button primary" disabled={!agreed} onClick={onAccept}>
          Allow AI and apply
        </button>
      </div>
    </dialog>
  )
}
