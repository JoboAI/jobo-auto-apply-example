import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { auth } from './auth'
import { authConfigIssues } from './config'

/**
 * The signed-in, email-verified user for this request, or null. Wrapped in
 * React's cache() so a layout and its page share one session lookup.
 */
export const currentUser = cache(async () => {
  if (authConfigIssues().length) return null
  const session = await auth().api.getSession({ headers: await headers() })
  return session?.user.emailVerified ? session.user : null
})

/** For pages and server actions: the user, or a redirect to /login. */
export async function requireUser() {
  const user = await currentUser()
  if (!user) redirect('/login')
  return user
}
