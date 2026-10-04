import Link from 'next/link'
import { KeyRound, TriangleAlert } from 'lucide-react'
import type { KeySettings } from '@/lib/user-settings'

/**
 * Which environment the visitor's key puts them in, in the top bar. It links
 * to the key settings: switching between sandbox and production is replacing
 * the key.
 */
export function EnvironmentBadge({ mode, keyHint }: Pick<KeySettings, 'mode' | 'keyHint'>) {
  if (!mode)
    return (
      <Link href="/onboarding" className="env-badge none">
        <KeyRound size={14} /> Connect API key
      </Link>
    )
  const production = mode === 'production'
  return (
    <Link
      href="/settings#api-key"
      className={`env-badge ${production ? 'production' : 'sandbox'}`}
      title="Manage your Jobo API key"
      aria-label={`${production ? 'Production — real employers' : 'Sandbox'}. Manage your Jobo API key.`}
    >
      {production ? (
        <TriangleAlert size={14} aria-hidden="true" />
      ) : (
        <span className="env-dot" aria-hidden="true" />
      )}
      {production ? 'Production — real employers' : 'Sandbox'}
      {keyHint && <span className="env-badge-hint">···{keyHint}</span>}
    </Link>
  )
}
