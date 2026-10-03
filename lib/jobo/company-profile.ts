import { z } from 'zod'
import { formatDate, httpsUrl, humanize, plainText, truncate } from './job-format'
import { valueLabel } from './job-filters'

/**
 * GET /api/companies/{id}: the full company profile (links, facts, funding,
 * leadership, ratings, tech stack), validated and shaped for the job page's
 * company tab. Pure; lib/jobo/jobs-api.ts does the fetching.
 */

const str = z.string().nullish()
export const companySchema = z.object({
  id: z.string(),
  name: z.string(),
  legal_name: str,
  summary: str,
  description: str,
  website: str,
  careers_url: str,
  ats_provider: str,
  logo_url: str,
  linkedin_url: str,
  twitter_url: str,
  facebook_url: str,
  instagram_url: str,
  angellist_url: str,
  youtube_url: str,
  github_url: str,
  crunchbase_url: str,
  headquarters_location: str,
  headquarters_city: str,
  headquarters_region: str,
  country_code: str,
  founding_year: str,
  company_size: str,
  revenue: str,
  is_agency: z.boolean().nullish(),
  industries: z.array(z.string()).nullish(),
  primary_industry: str,
  categories: z.array(z.string()).nullish(),
  operating_status: str,
  ipo_status: str,
  company_type: str,
  stock_symbol: str,
  stock_exchange: str,
  is_acquired: z.boolean().nullish(),
  acquired_by_company: str,
  funding_stage: str,
  total_funding: str,
  funds_total_formatted: str,
  investors: z.array(z.string()).nullish(),
  funding_rounds: z
    .array(
      z.object({
        investment_type: str,
        announced_on: str,
        raised_amount: str,
        post_money_valuation: str,
        lead_investor: str,
      }),
    )
    .nullish(),
  founders: z.array(z.string()).nullish(),
  leadership: z
    .array(z.object({ name: str, title: str, linkedin_url: str, avatar_url: str }))
    .nullish(),
  ratings: z
    .array(
      z.object({
        source: str,
        rating: z.union([z.string(), z.number()]).nullish(),
        url: str,
        review_count: z.number().nullish(),
      }),
    )
    .nullish(),
  press_references: z
    .array(z.object({ url: str, posted_on: str, title: str, publisher: str }))
    .nullish(),
  products: z.array(z.object({ name: str, description: str })).nullish(),
  acquisitions: z.array(z.object({ acquiree_name: str, title: str })).nullish(),
  subsidiary_list: z.array(z.string()).nullish(),
  tech_stack: z.array(z.object({ name: z.string().nullish() })).nullish(),
  technologies: z.array(z.string()).nullish(),
})

/** The networks a company profile can link to, in display order. */
export const COMPANY_LINK_KINDS = [
  'website',
  'careers',
  'linkedin',
  'twitter',
  'github',
  'crunchbase',
  'angellist',
  'youtube',
  'instagram',
  'facebook',
] as const
export type CompanyLinkKind = (typeof COMPANY_LINK_KINDS)[number]

export interface CompanyProfile {
  id: string
  name: string
  legalName?: string
  /** One-line blurb, shown above `about` when both exist. */
  tagline?: string
  about?: string
  website?: string
  logoUrl?: string
  links: { kind: CompanyLinkKind; href: string }[]
  /** ATS provider id the company hires through, when detected. */
  atsProvider?: string
  facts: { label: string; value: string }[]
  industries: string[]
  categories: string[]
  investors: string[]
  fundingRounds: {
    type?: string
    date?: string
    amount?: string
    valuation?: string
    lead?: string
  }[]
  founders: string[]
  leadership: { name: string; title?: string; linkedinUrl?: string; avatarUrl?: string }[]
  ratings: { source: string; rating: string; reviewCount?: number; url?: string }[]
  press: { title: string; publisher?: string; date?: string; url?: string }[]
  products: { name: string; description?: string }[]
  acquisitions: string[]
  subsidiaries: string[]
  techStack: string[]
}

/** "series_b" → "Series B". */
function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase())
}

function sizeLabel(value: string): string {
  return /employees?/i.test(value) ? value : `${value} employees`
}

function uniqueText(values: (string | null | undefined)[], max: number): string[] {
  return [...new Set(values.map((v) => v?.trim() ?? '').filter(Boolean))].slice(0, max)
}

export function toCompanyProfile(dto: z.infer<typeof companySchema>): CompanyProfile {
  const text = (value: string | null | undefined) => value?.trim() || undefined
  const facts: { label: string; value: string }[] = []
  const add = (label: string, value: string | undefined) => value && facts.push({ label, value })
  add('Headcount', text(dto.company_size) && sizeLabel(dto.company_size!.trim()))
  add('Founded', text(dto.founding_year))
  add('Headquarters', text(dto.headquarters_location) ?? text(dto.headquarters_city))
  add('Funding stage', text(dto.funding_stage) && titleCase(dto.funding_stage!))
  add('Total raised', text(dto.funds_total_formatted) ?? text(dto.total_funding))
  add('Revenue', text(dto.revenue))
  add(
    'Ownership',
    text(dto.stock_symbol)
      ? `Public · ${[text(dto.stock_exchange)?.toUpperCase(), dto.stock_symbol!.trim()].filter(Boolean).join(': ')}`
      : text(dto.ipo_status) && humanize(dto.ipo_status),
  )
  add('Company type', text(dto.company_type) && humanize(dto.company_type))
  add('Industry', text(dto.primary_industry))
  add(
    'Acquired by',
    dto.is_acquired || text(dto.acquired_by_company)
      ? (text(dto.acquired_by_company) ?? 'Yes')
      : undefined,
  )
  add('Status', dto.operating_status?.toLowerCase() === 'closed' ? 'Closed' : undefined)
  add('Agency', dto.is_agency ? 'Staffing / recruiting agency' : undefined)
  const stack = [...(dto.tech_stack ?? []).map((t) => t.name ?? ''), ...(dto.technologies ?? [])]
  const summary = plainText(dto.summary || '')
  const description = plainText(dto.description || '')
  const about = description || summary
  const website = text(dto.website)
  const href = (value: string | null | undefined) => httpsUrl(value) || undefined
  const linkUrls: Record<CompanyLinkKind, string | undefined> = {
    website: website ? href(/^https?:/i.test(website) ? website : `https://${website}`) : undefined,
    careers: href(dto.careers_url),
    linkedin: href(dto.linkedin_url),
    twitter: href(dto.twitter_url),
    github: href(dto.github_url),
    crunchbase: href(dto.crunchbase_url),
    angellist: href(dto.angellist_url),
    youtube: href(dto.youtube_url),
    instagram: href(dto.instagram_url),
    facebook: href(dto.facebook_url),
  }
  const legalName = text(dto.legal_name)
  return {
    id: dto.id,
    name: dto.name,
    legalName:
      legalName && legalName.toLowerCase() !== dto.name.trim().toLowerCase()
        ? legalName
        : undefined,
    tagline:
      description && summary && !description.startsWith(summary.slice(0, 60))
        ? truncate(summary, 220)
        : undefined,
    about: about ? truncate(about, 1500) : undefined,
    website: linkUrls.website,
    logoUrl: httpsUrl(dto.logo_url) || undefined,
    links: COMPANY_LINK_KINDS.flatMap((kind) =>
      linkUrls[kind] ? [{ kind, href: linkUrls[kind]! }] : [],
    ),
    atsProvider: text(dto.ats_provider)?.toLowerCase(),
    facts,
    industries: dto.industries ?? [],
    categories: (dto.categories ?? []).map(valueLabel),
    investors: uniqueText(dto.investors ?? [], 8),
    fundingRounds: (dto.funding_rounds ?? [])
      .filter((r) => r.investment_type || r.raised_amount)
      .sort(
        (a, b) => (Date.parse(b.announced_on ?? '') || 0) - (Date.parse(a.announced_on ?? '') || 0),
      )
      .slice(0, 6)
      .map((r) => ({
        type: text(r.investment_type) && titleCase(r.investment_type!),
        date: formatDate(r.announced_on) ?? text(r.announced_on),
        amount: text(r.raised_amount),
        valuation: text(r.post_money_valuation),
        lead: text(r.lead_investor),
      })),
    founders: uniqueText(dto.founders ?? [], 6),
    leadership: (dto.leadership ?? [])
      .filter((l) => text(l.name))
      .slice(0, 6)
      .map((l) => ({
        name: l.name!.trim(),
        title: text(l.title),
        linkedinUrl: href(l.linkedin_url),
        avatarUrl: href(l.avatar_url),
      })),
    ratings: (dto.ratings ?? []).flatMap((r) => {
      const rating = r.rating == null ? '' : String(r.rating).trim()
      return text(r.source) && rating
        ? [
            {
              source: titleCase(r.source!),
              rating,
              reviewCount: r.review_count ?? undefined,
              url: href(r.url),
            },
          ]
        : []
    }),
    press: (dto.press_references ?? [])
      .filter((p) => text(p.title))
      .slice(0, 5)
      .map((p) => ({
        title: p.title!.trim(),
        publisher: text(p.publisher),
        date: formatDate(p.posted_on),
        url: href(p.url),
      })),
    products: (dto.products ?? [])
      .filter((p) => text(p.name))
      .slice(0, 6)
      .map((p) => ({
        name: p.name!.trim(),
        description: text(p.description) && truncate(plainText(p.description!), 200),
      })),
    acquisitions: uniqueText(
      (dto.acquisitions ?? []).map((a) => a.acquiree_name ?? a.title),
      8,
    ),
    subsidiaries: uniqueText(dto.subsidiary_list ?? [], 8),
    techStack: [...new Set(stack.map((t) => t.trim()).filter(Boolean))].slice(0, 20),
  }
}
