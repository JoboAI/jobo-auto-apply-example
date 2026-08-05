import type { Metadata } from 'next'
import Link from 'next/link'
import { Inter, Manrope } from 'next/font/google'
import { GeistMono } from 'geist/font/mono'
import { getTutorialState, TUTORIAL_STEPS } from '@/lib/tutorial'
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
    'A guided tutorial: import a resume as a profile, apply to a job by URL, and answer the ATS form over a signed webhook.'
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
  const currentSlug = state ? TUTORIAL_STEPS[state.currentStep - 1].slug : 'connect'

  const nav = [
    { href: `/learn/${currentSlug}`, label: 'Tutorial' },
    { href: '/profiles', label: 'Profiles' },
    { href: '/applications', label: 'Applications' }
  ]

  return (
    <html lang="en" className={`${inter.variable} ${manrope.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen bg-white antialiased">
        <header className="sticky top-0 z-50 border-b hairline bg-white">
          <div className="mx-auto flex h-14 max-w-[1264px] items-center gap-6 px-4 sm:px-8">
            <Link href="/" className="flex items-center gap-3">
              <span className="text-sm font-semibold tracking-tight text-ink-900">Jobo</span>
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
                href={`/learn/${currentSlug}`}
                className="ml-auto hidden items-center gap-2 bg-brand-tint px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.05em] text-brand sm:inline-flex"
              >
                Step {state.currentStep} of 5
              </Link>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-[1264px] px-4 py-8 sm:px-8">{children}</main>
        <footer className="mx-auto max-w-[1264px] px-4 pb-10 pt-4 sm:px-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-ink-500">
            API contract 2026-07-21 · the interesting file is app/api/jobo/webhook/route.ts
          </p>
        </footer>
      </body>
    </html>
  )
}
