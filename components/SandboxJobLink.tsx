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
