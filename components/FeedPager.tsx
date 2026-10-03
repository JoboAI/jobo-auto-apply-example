import { ArrowLeft, ArrowRight } from 'lucide-react'
import { pageHref, type JobFilters } from '@/lib/jobo/job-filters'
import { PageLink } from './PageLink'

/** Previous / next links for production search results. */
export function FeedPager({
  search,
}: {
  search: { filters: JobFilters; page: number; totalPages: number }
}) {
  if (search.totalPages <= 1) return null
  return (
    <nav className="pager" aria-label="Job result pages">
      {search.page > 1 ? (
        <PageLink
          className="button secondary small"
          href={pageHref(search.filters, search.page - 1)}
        >
          <ArrowLeft size={15} /> Previous
        </PageLink>
      ) : (
        <span />
      )}
      <span className="subtle">
        Page {search.page} of {search.totalPages.toLocaleString('en')}
      </span>
      {search.page < search.totalPages ? (
        <PageLink
          className="button secondary small"
          href={pageHref(search.filters, search.page + 1)}
        >
          Next <ArrowRight size={15} />
        </PageLink>
      ) : (
        <span />
      )}
    </nav>
  )
}
