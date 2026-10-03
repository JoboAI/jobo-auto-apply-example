import { PageLink } from '@/components/PageLink'
import { ArrowRight, ArrowUpRight, BriefcaseBusiness, Building2, Globe, Star } from 'lucide-react'
import type { CompanyLinkKind, CompanyProfile } from '@/lib/jobo/jobs-api'
import { AtsBadge } from './AtsBadge'
import { BrandIcon, isBrand } from './BrandIcon'

const LINK_LABELS: Record<CompanyLinkKind, string> = {
  website: 'Website',
  careers: 'Careers page',
  linkedin: 'LinkedIn',
  twitter: 'X (Twitter)',
  github: 'GitHub',
  crunchbase: 'Crunchbase',
  angellist: 'Wellfound',
  youtube: 'YouTube',
  instagram: 'Instagram',
  facebook: 'Facebook',
}

function LinkIcon({ kind, size = 17 }: { kind: CompanyLinkKind; size?: number }) {
  if (kind === 'website') return <Globe size={size} aria-hidden="true" />
  if (kind === 'careers') return <BriefcaseBusiness size={size} aria-hidden="true" />
  return isBrand(kind) ? <BrandIcon brand={kind} size={size - 1} /> : null
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="company-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

/**
 * The "About {company}" tab: the hiring company's enriched profile from
 * `GET /api/companies/{id}`, which is free. Job search only carries a summary
 * of it (name, industries, categories). Every section hides when empty.
 */
export function CompanyPanel({
  company,
  ats,
}: {
  company: CompanyProfile
  /** The ATS the company hires through, resolved to a name and logo. */
  ats?: { name: string; logoUrl?: string }
}) {
  const tags = [...company.categories, ...company.industries]
  const facts = ats
    ? [
        ...company.facts,
        { label: 'Hires through', value: <AtsBadge name={ats.name} logoUrl={ats.logoUrl} /> },
      ]
    : company.facts
  return (
    <section className="company-tab" aria-label={`About ${company.name}`}>
      <div className="company-tab-head">
        {company.logoUrl ? (
          <img className="company-mark large-mark company-logo" src={company.logoUrl} alt="" />
        ) : (
          <span className="company-mark large-mark purple">
            <Building2 size={22} />
          </span>
        )}
        <div className="company-tab-title">
          <span className="eyebrow">COMPANY PROFILE · JOBS API</span>
          <h2>{company.name}</h2>
          {company.legalName && <p className="legal-name">{company.legalName}</p>}
        </div>
      </div>
      {company.links.length > 0 && (
        <nav className="brand-links" aria-label={`${company.name} links`}>
          {company.links.map((link) => (
            <a
              key={link.kind}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`brand-link brand-${link.kind}`}
              aria-label={LINK_LABELS[link.kind]}
              title={LINK_LABELS[link.kind]}
            >
              <LinkIcon kind={link.kind} />
              {(link.kind === 'website' || link.kind === 'careers') && (
                <span>{LINK_LABELS[link.kind]}</span>
              )}
            </a>
          ))}
        </nav>
      )}
      {company.tagline && <p className="company-tagline">{company.tagline}</p>}
      {company.about && <p className="company-about">{company.about}</p>}
      {facts.length > 0 && (
        <dl className="company-facts">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {tags.length > 0 && (
        <div className="tag-row">
          {tags.map((tag) => (
            <span key={tag} className="tag purple-tag">
              {tag}
            </span>
          ))}
        </div>
      )}
      {(company.leadership.length > 0 || company.founders.length > 0) && (
        <Section title="Leadership">
          {company.leadership.length > 0 && (
            <ul className="leader-list">
              {company.leadership.map((leader) => (
                <li key={leader.name}>
                  {leader.avatarUrl ? (
                    <img className="leader-avatar" src={leader.avatarUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="leader-avatar">{initials(leader.name)}</span>
                  )}
                  <span className="leader-text">
                    <strong>{leader.name}</strong>
                    {leader.title && <small>{leader.title}</small>}
                  </span>
                  {leader.linkedinUrl && (
                    <a
                      href={leader.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="brand-link small brand-linkedin"
                      aria-label={`${leader.name} on LinkedIn`}
                      title="LinkedIn"
                    >
                      <BrandIcon brand="linkedin" size={13} />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          {company.founders.length > 0 && (
            <p className="company-note">
              <strong>Founded by</strong> {company.founders.join(', ')}
            </p>
          )}
        </Section>
      )}
      {(company.fundingRounds.length > 0 || company.investors.length > 0) && (
        <Section title="Funding">
          {company.fundingRounds.length > 0 && (
            <div className="table-scroll">
              <table className="funding-table">
                <thead>
                  <tr>
                    <th>Round</th>
                    <th>Announced</th>
                    <th>Raised</th>
                    <th>Lead investor</th>
                  </tr>
                </thead>
                <tbody>
                  {company.fundingRounds.map((round, i) => (
                    <tr key={i}>
                      <td>{round.type ?? '—'}</td>
                      <td>{round.date ?? '—'}</td>
                      <td>
                        {round.amount ?? '—'}
                        {round.valuation && <small> · {round.valuation} post</small>}
                      </td>
                      <td>{round.lead ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {company.investors.length > 0 && (
            <p className="company-note">
              <strong>Backed by</strong> {company.investors.join(', ')}
            </p>
          )}
        </Section>
      )}
      {company.products.length > 0 && (
        <Section title="Products">
          <ul className="product-list">
            {company.products.map((p) => (
              <li key={p.name}>
                <strong>{p.name}</strong>
                {p.description && <span>{p.description}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {company.ratings.length > 0 && (
        <Section title="Employee ratings">
          <ul className="rating-list">
            {company.ratings.map((r) => {
              const body = (
                <>
                  <Star size={14} aria-hidden="true" />
                  <strong>{r.rating}</strong>
                  <span>
                    {r.source}
                    {r.reviewCount !== undefined &&
                      ` · ${r.reviewCount.toLocaleString('en')} reviews`}
                  </span>
                </>
              )
              return (
                <li key={r.source}>
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noopener noreferrer">
                      {body}
                      <ArrowUpRight size={13} />
                    </a>
                  ) : (
                    body
                  )}
                </li>
              )
            })}
          </ul>
        </Section>
      )}
      {company.press.length > 0 && (
        <Section title="In the press">
          <ul className="press-list">
            {company.press.map((p) => (
              <li key={p.title}>
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noopener noreferrer">
                    {p.title} <ArrowUpRight size={13} />
                  </a>
                ) : (
                  <span>{p.title}</span>
                )}
                {(p.publisher || p.date) && (
                  <small>{[p.publisher, p.date].filter(Boolean).join(' · ')}</small>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {company.techStack.length > 0 && (
        <Section title="Tech stack">
          <div className="tag-row">
            {company.techStack.map((tech) => (
              <span key={tech} className="tag">
                {tech}
              </span>
            ))}
          </div>
        </Section>
      )}
      {(company.acquisitions.length > 0 || company.subsidiaries.length > 0) && (
        <Section title="Corporate family">
          {company.acquisitions.length > 0 && (
            <p className="company-note">
              <strong>Acquired</strong> {company.acquisitions.join(', ')}
            </p>
          )}
          {company.subsidiaries.length > 0 && (
            <p className="company-note">
              <strong>Subsidiaries</strong> {company.subsidiaries.join(', ')}
            </p>
          )}
        </Section>
      )}
      <PageLink href={`/jobs?co=${company.id}`} className="button secondary company-more">
        More jobs at {company.name} <ArrowRight size={15} />
      </PageLink>
    </section>
  )
}
