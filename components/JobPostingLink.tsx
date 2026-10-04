import { ArrowUpRight } from 'lucide-react'

/**
 * A job's original posting, on its ATS: the employer's for a real job, the
 * sandbox form on sandbox.jobo.world for a sandbox job.
 */
export function JobPostingLink({
  url,
  ats,
  atsLogoUrl,
  title,
}: {
  url: string
  ats?: string
  atsLogoUrl?: string
  title: string
}) {
  let host: string
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return null
    host = parsed.hostname
  } catch {
    return null
  }
  return (
    <a
      className="job-posting-link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`View ${title} on ${host} (opens in a new tab)`}
    >
      <span className="ats-badge">
        {atsLogoUrl && <img src={atsLogoUrl} alt="" width={16} height={16} />}
        {ats ? `View on ${ats}` : 'View original posting'}
      </span>
      <strong>
        {host} <ArrowUpRight size={15} />
      </strong>
    </a>
  )
}
