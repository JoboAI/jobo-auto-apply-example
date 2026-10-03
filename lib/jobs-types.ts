export interface Job {
  slug: string
  company: string
  mark: string
  role: string
  location: string
  department: string
  employmentType: string
  about: string
  responsibilities: string[]
  applyUrl: string
  available: boolean
  /** Set on production-mode jobs, which come from the real Jobo catalog. */
  production?: boolean
  /** The ATS id (`greenhouse`, `lever`, …) — also the Auto Apply provider id. */
  source?: string
  sourceName?: string
  /** The ATS's mark, shipped in `public/ats-logos/`. */
  sourceLogoUrl?: string
  listingUrl?: string
  logoUrl?: string
  /** ISO 3166 alpha-2, when the catalog knows it. */
  countryCode?: string
  // ── Catalog data, production jobs only ─────────────────────────────
  companyId?: string
  companyWebsite?: string
  industries?: string[]
  /** Business-model buckets, display form ("SaaS", "B2B"). */
  companyCategories?: string[]
  /** Display values from the API ("Remote", "Senior"). */
  workModel?: string
  experienceLevel?: string
  /** "$120k–$160k/yr" when the employer disclosed pay. */
  salary?: string
  postedAgo?: string
  /** Must-have skills extracted from the posting. */
  skills?: string[]
}
