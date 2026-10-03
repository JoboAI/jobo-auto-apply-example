'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BriefcaseBusiness, Bookmark, LayoutList, UserRound } from 'lucide-react'
import { PageLink } from './PageLink'

// `fullLoad`: the job feed pages are the heaviest, and soft navigations into
// them intermittently fail to commit (see components/PageLink.tsx).
const links = [
  { href: '/jobs', label: 'Discover jobs', icon: BriefcaseBusiness, fullLoad: true },
  { href: '/saved', label: 'Saved jobs', icon: Bookmark, fullLoad: true },
  { href: '/applications', label: 'Applications', icon: LayoutList, fullLoad: false },
  { href: '/profiles', label: 'My profile', icon: UserRound, fullLoad: false },
]
/** The sidebar navigation, with the current section highlighted. */
export function MainNav() {
  const path = usePathname()
  return (
    <nav aria-label="Main navigation">
      {links.map(({ href, label, icon: Icon, fullLoad }) => {
        const NavLink = fullLoad ? PageLink : Link
        return (
          <NavLink
            key={href}
            href={href}
            className={`nav-item ${path.startsWith(href) ? 'active' : ''}`}
            aria-current={path.startsWith(href) ? 'page' : undefined}
          >
            <Icon size={19} />
            <span>{label}</span>
            {path.startsWith(href) && <span className="nav-dot" />}
          </NavLink>
        )
      })}
    </nav>
  )
}
