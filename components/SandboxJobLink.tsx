import { ArrowUpRight } from 'lucide-react'
import { validSandboxUrl } from '@/lib/jobs'

export function SandboxJobLink({ url, slug, title }: { url: string; slug: string; title: string }) {
  if (!validSandboxUrl(url, slug)) return null
  return (
    <a className="sandbox-job-link" href={url} target="_blank" rel="noopener noreferrer"
      aria-label={`View ${title} on sandbox.jobo.world (opens in a new tab)`}>
      <span>View sandbox form</span>
      <strong>sandbox.jobo.world <ArrowUpRight size={15} /></strong>
    </a>
  )
}

/** A production job's original posting, on the employer's ATS. */
export function ProductionJobLink({ url, ats, title }: { url: string; ats?: string; title: string }) {
  let host: string
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return null
    host = parsed.hostname
  } catch {
    return null
  }
  return (
    <a className="sandbox-job-link" href={url} target="_blank" rel="noopener noreferrer"
      aria-label={`View ${title} on ${host} (opens in a new tab)`}>
      <span>{ats ? `View on ${ats}` : 'View original posting'}</span>
      <strong>{host} <ArrowUpRight size={15} /></strong>
    </a>
  )
}
