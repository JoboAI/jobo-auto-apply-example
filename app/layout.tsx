import type { Metadata } from 'next'
import Link from 'next/link'
import { Inter, Manrope } from 'next/font/google'
import { GeistMono } from 'geist/font/mono'
import { getTutorialState } from '@/lib/tutorial'
import './globals.css'

/*
 * Fonts follow the portal's three-voice system, self-hosted at build time
 * (next/font downloads once and serves locally — no CDN at runtime):
 *   Inter      — all UI text
 *   Manrope    — display headings, weight 500 only
 *   Geist Mono — eyebrows, labels, IDs, code
 */
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const manrope = Manrope({ subsets: ['latin'], weight: ['500'], variable: '--font-manrope' })

export const metadata: Metadata = {
  title: 'Jobo Auto Apply — Next.js example',
  description:
    'A notebook-style tutorial: create an application, receive the form fields synchronously, and watch the answer engine drive it to submitted — all on one page.',
  // Declared rather than relying on app/favicon.ico discovery, because these
  // live in public/ where brand-kit/generate.mjs writes them.
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '48x48' }
    ]
  }
}

// The nav chip reads tutorial state from SQLite on every request; nothing in
// this app is worth prerendering at build time.
export const dynamic = 'force-dynamic'

function safeTutorialState() {
  try {
    return getTutorialState()
  } catch {
    // A broken .data directory should degrade the chip, not the whole shell.
    return null
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const state = safeTutorialState()

  const nav = [
    { href: '/learn', label: 'Tutorial' },
    { href: '/profiles', label: 'Profiles' },
    { href: '/applications', label: 'Applications' }
  ]

  return (
    <html lang="en" className={`${inter.variable} ${manrope.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen bg-white antialiased">
        <header className="sticky top-0 z-50 border-b hairline bg-white">
          <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-4 sm:px-8">
            <Link href="/" className="flex items-center gap-3">
              {/* The real lockup from brand-kit/, generated into public/logos
                  by brand-kit/generate.mjs — not a hand-copied SVG, so
                  `generate.mjs --check` catches drift. The master is cropped to
                  its glyph bounds, so this height renders that many pixels. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logos/jobo-logo.svg" alt="Jobo" className="h-[18px] w-auto" />
              <span className="hidden h-5 w-px bg-ink-200 sm:block" />
              <span className="hidden text-sm font-medium tracking-tight text-ink-600 sm:block">
                Auto Apply example
              </span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="px-2.5 py-1.5 text-ink-800 transition-colors duration-150 ease-out hover:bg-ink-100 hover:text-ink-900"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            {state && !state.complete && (
              <Link
                href="/learn"
                className="ml-auto hidden items-center gap-2 bg-brand-tint px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.05em] text-brand sm:inline-flex"
              >
                Step {state.milestone} of 3
              </Link>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-8">{children}</main>
        <footer className="mx-auto max-w-[1600px] px-4 pb-10 pt-4 sm:px-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-ink-500">
            API contract 2026-08-31 · the interesting file is app/actions/applications.ts
          </p>
        </footer>
      </body>
    </html>
  )
}
