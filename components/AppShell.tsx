'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SourceLink } from '@/components/SourceLink'
import {
  BriefcaseBusiness,
  Bookmark,
  LayoutList,
  UserRound,
  ArrowUpRight,
  Sparkles,
  Settings,
} from 'lucide-react'
const links = [
  { href: '/jobs', label: 'Discover jobs', icon: BriefcaseBusiness },
  { href: '/saved', label: 'Saved jobs', icon: Bookmark },
  { href: '/applications', label: 'Applications', icon: LayoutList },
  { href: '/profiles', label: 'My profile', icon: UserRound },
]
export function AppShell({
  name,
  email,
  children,
}: {
  name: string
  email: string
  children: React.ReactNode
}) {
  const path = usePathname()
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link className="logo" href="/jobs">
          <img src="/logos/jobo-logo.svg" alt="Jobo" />
          <span>auto apply</span>
        </Link>
        <div className="workspace-label">DEVELOPER SANDBOX</div>
        <nav aria-label="Main navigation">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`nav-item ${path.startsWith(href) ? 'active' : ''}`}
              aria-current={path.startsWith(href) ? 'page' : undefined}
            >
              <Icon size={19} />
              <span>{label}</span>
              {path.startsWith(href) && <span className="nav-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sandbox-note">
            <span className="mini-icon">
              <Sparkles size={18} />
            </span>
            <strong>This is the Auto Apply Demo.</strong>
            <p>
              See the API in action with fictional jobs, then explore the source
              to build your own integration.
            </p>
            <a
              href="https://sandbox.jobo.world"
              target="_blank"
              rel="noreferrer"
            >
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
          <Link href="/jobs" className="mobile-brand logo">
            <img src="/logos/jobo-logo.svg" alt="Jobo" />
          </Link>
          <div className="topbar-actions">
            <span className="sandbox-pill">
              <span />
              Auto Apply Demo
            </span>
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
          <span>Jobo Auto Apply Demo · No real employers contacted.</span>
          <SourceLink />
        </footer>
      </div>
    </div>
  )
}
