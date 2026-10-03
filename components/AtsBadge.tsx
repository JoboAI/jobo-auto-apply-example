import { Workflow } from 'lucide-react'

/**
 * An ATS by name, with its mark when this app ships one
 * (`public/ats-logos/`).
 */
export function AtsBadge({
  name,
  logoUrl,
  size = 16,
  className = '',
}: {
  name: string
  logoUrl?: string
  size?: number
  className?: string
}) {
  return (
    <span className={`ats-badge ${className}`.trim()}>
      {logoUrl ? (
        <img src={logoUrl} alt="" width={size} height={size} />
      ) : (
        <Workflow size={size} aria-hidden="true" />
      )}
      {name}
    </span>
  )
}
