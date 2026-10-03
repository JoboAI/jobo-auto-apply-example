'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ApiDocsLink, SourceLink } from '@/components/SourceLink'
import { ModeToggle, type ModeProps } from '@/components/ModeToggle'
import { PageLink } from '@/components/PageLink'
import {
  BriefcaseBusiness,
  Bookmark,
  LayoutList,
  UserRound,
  ArrowUpRight,
  Sparkles,
  Settings,
} from 'lucide-react'
// `fullLoad`: the job feed pages are the heaviest, and soft navigations into
// them intermittently fail to commit (see components/PageLink.tsx).
const links = [
  { href: '/jobs', label: 'Discover jobs', icon: BriefcaseBusiness, fullLoad: true },
  { href: '/saved', label: 'Saved jobs', icon: Bookmark, fullLoad: true },
  { href: '/applications', label: 'Applications', icon: LayoutList, fullLoad: false },
  { href: '/profiles', label: 'My profile', icon: UserRound, fullLoad: false },
]
export function AppShell({
  name,
  email,
  settings,
  children,
}: {
  name: string
  email: string
  settings: ModeProps
  children: React.ReactNode
}) {
  const path = usePathname()
  const production = settings.mode === 'production'
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <PageLink className="logo" href="/jobs">
          <img src="/logos/jobo-logo.svg" alt="Jobo" />
          <span>auto apply</span>
        </PageLink>
        <div className={`workspace-label ${production ? 'production' : ''}`}>
          {production ? 'PRODUCTION MODE' : 'DEVELOPER SANDBOX'}
        </div>
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
        <div className="sidebar-bottom">
          <div className="sandbox-note">
            <span className="mini-icon">
              <Sparkles size={18} />
            </span>
            <strong>This is the Auto Apply Demo.</strong>
            <p>
              {production
                ? 'You are applying to real jobs on your own Jobo API key. Switch back to sandbox any time.'
                : 'See the API in action with fictional jobs, then explore the source to build your own integration.'}
            </p>
            <a href="https://sandbox.jobo.world" target="_blank" rel="noreferrer">
              Explore the sandbox <ArrowUpRight size={14} />
            </a>
          </div>
          <Link href="/settings" className="account-link">
            <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>{name}</strong>
              <small>{email}</small>
            </span>
            <Settings size={17} />
          </Link>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="topbar-tagline">Auto Apply API · Integration demo</span>
          <PageLink href="/jobs" className="mobile-brand logo">
            <img src="/logos/jobo-logo.svg" alt="Jobo" />
          </PageLink>
          <div className="topbar-actions">
            <ModeToggle {...settings} />
            <ApiDocsLink compact />
            <SourceLink compact />
            <Link
              href="/settings"
              className="mobile-account icon-button"
              aria-label="Account settings"
            >
              <UserRound size={17} />
            </Link>
          </div>
        </header>
        <main id="main" className="main-content">
          {children}
        </main>
        <footer className="app-footer">
          <span>
            {production
              ? 'Jobo Auto Apply Demo · Production mode: applications go to real employers.'
              : 'Jobo Auto Apply Demo · No real employers contacted.'}
          </span>
          <div className="developer-links">
            <ApiDocsLink />
            <SourceLink />
          </div>
        </footer>
      </div>
    </div>
  )
}
