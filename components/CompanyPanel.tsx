import Link from 'next/link'
import { ArrowRight, ArrowUpRight, Building2 } from 'lucide-react'
import type { CompanyProfile } from '@/lib/jobo/jobs-api'

/**
 * The hiring company's enriched profile from `GET /api/companies/{id}`, which
 * is free. Job search only carries a summary of it (name, industries,
 * categories); headcount, funding, investors and tech stack live here.
 */
export function CompanyPanel({ company }: { company: CompanyProfile }) {
  const links = [
    company.website && { href: company.website, label: 'Website' },
    company.linkedinUrl && { href: company.linkedinUrl, label: 'LinkedIn' },
    company.crunchbaseUrl && { href: company.crunchbaseUrl, label: 'Crunchbase' },
  ].filter((l): l is { href: string; label: string } => !!l)
  const tags = [...company.categories, ...company.industries]
  return (
    <section className="aside-card company-panel" aria-label={`About ${company.name}`}>
      <span className="eyebrow">COMPANY PROFILE · JOBS API</span>
      <div className="company-panel-head">
        {company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="company-mark company-logo" src={company.logoUrl} alt="" />
        ) : (
          <span className="company-mark purple">
            <Building2 size={18} />
          </span>
        )}
        <h2>{company.name}</h2>
      </div>
      {company.about && <p className="company-about">{company.about}</p>}
      {company.facts.length > 0 && (
        <dl className="company-facts">
          {company.facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {tags.length > 0 && (
        <div className="tag-row">
          {tags.slice(0, 6).map((tag) => (
            <span key={tag} className="tag purple-tag">
              {tag}
            </span>
          ))}
        </div>
      )}
      {company.investors.length > 0 && (
        <div className="company-list">
          <h3>Backed by</h3>
          <p>{company.investors.join(', ')}</p>
        </div>
      )}
      {company.techStack.length > 0 && (
        <div className="company-list">
          <h3>Tech stack</h3>
          <div className="tag-row">
            {company.techStack.map((tech) => (
              <span key={tech} className="tag">
                {tech}
              </span>
            ))}
          </div>
        </div>
      )}
      {links.length > 0 && (
        <div className="company-links">
          {links.map((link) => (
            <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer">
              {link.label} <ArrowUpRight size={13} />
            </a>
          ))}
        </div>
      )}
      <Link href={`/jobs?co=${company.id}`} className="button secondary full-width">
        More jobs at {company.name} <ArrowRight size={15} />
      </Link>
    </section>
  )
}
