import { notFound, redirect } from 'next/navigation'

/**
 * The tutorial used to be five pages under /learn/<step>; it is now one
 * notebook at /learn. This stub keeps old bookmarks (and the odd README link
 * in the wild) working, including /learn/watch?app=<id> deep links.
 */

const LEGACY_STEPS = new Set(['connect', 'profile', 'create', 'watch', 'done'])

export default async function LegacyStepRedirect({
  params,
  searchParams
}: {
  params: Promise<{ step: string }>
  searchParams: Promise<{ app?: string }>
}) {
  const { step } = await params
  if (!LEGACY_STEPS.has(step)) notFound()

  const { app } = await searchParams
  redirect(app ? `/learn?app=${encodeURIComponent(app)}` : '/learn')
}
