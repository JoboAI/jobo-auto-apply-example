import type { AnchorHTMLAttributes } from 'react'

/**
 * An internal link that does a full page load instead of a client-side
 * navigation. Used on the job feed and explorer, the app's heaviest pages,
 * where soft navigations intermittently fail to commit (see lib/use-busy.ts).
 * Everywhere else, use next/link as usual.
 */
export function PageLink(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props} />
}
