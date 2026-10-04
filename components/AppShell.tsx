import Link from 'next/link'
import { ApiDocsLink, SourceLink } from '@/components/SourceLink'
import { EnvironmentBadge } from '@/components/EnvironmentBadge'
import { PageLink } from '@/components/PageLink'
import { MainNav } from '@/components/MainNav'
import { UserRound, ArrowUpRight, Sparkles, Settings } from 'lucide-react'
import type { KeySettings } from '@/lib/user-settings'
/**
 * The signed-in layout: sidebar navigation, top bar with the environment
 * badge (from the visitor's key), and footer. A server component; only the
 * navigation, which highlights the current page, runs in the browser.
 */
export function AppShell({
  name,
  email,
  settings,
  children,
}: {
  name: string
  email: string
  settings: KeySettings
  children: React.ReactNode
}) {
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
          {production ? 'PRODUCTION · REAL EMPLOYERS' : 'DEVELOPER SANDBOX'}
        </div>
        <MainNav />
        <div className="sidebar-bottom">
          <div className="sandbox-note">
            <span className="mini-icon">
              <Sparkles size={18} />
            </span>
            <strong>This is the Auto Apply Demo.</strong>
            <p>
              {production
                ? 'You are applying to real jobs on your production key. Connect a sandbox key to switch back any time.'
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
            <EnvironmentBadge mode={settings.mode} keyHint={settings.keyHint} />
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
              ? 'Jobo Auto Apply Demo · Production key: applications go to real employers.'
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
