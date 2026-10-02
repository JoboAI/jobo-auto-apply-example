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
  listingUrl?: string
  logoUrl?: string
  /** ISO 3166 alpha-2, when the catalog knows it. */
  countryCode?: string
}
