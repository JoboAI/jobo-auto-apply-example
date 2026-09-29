import { auth, authConfigIssues } from '@/lib/auth'
export const runtime = 'nodejs'
async function handler(request: Request) {
  if (authConfigIssues().length)
    return Response.json(
      { message: 'Account service is temporarily unavailable.' },
      { status: 503 },
    )
  return auth().handler(request)
}
export { handler as GET, handler as POST }
