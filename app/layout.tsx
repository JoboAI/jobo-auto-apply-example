import type { Metadata } from 'next'
import { Inter, Manrope } from 'next/font/google'
import './globals.css'
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope' })
export const metadata: Metadata = {
  title: {
    default: 'Jobo Auto Apply Demo',
    template: '%s · Jobo Auto Apply Demo',
  },
  description:
    'Explore the Jobo Auto Apply API in a working developer demo. Apply to fictional sandbox jobs, track real API progress, and use the open-source integration in your own app.',
  icons: { icon: '/favicon.svg' },
}
export const dynamic = 'force-dynamic'
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${manrope.variable}`}>
      <body>{children}</body>
    </html>
  )
}
