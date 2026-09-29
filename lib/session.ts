import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth, authConfigIssues } from './auth'

export async function currentUser() {
  if (authConfigIssues().length) return null
  const session = await auth().api.getSession({ headers: await headers() })
  return session?.user.emailVerified ? session.user : null
}
export async function requireUser() {
  const user = await currentUser()
  if (!user) redirect('/login')
  return user
}
