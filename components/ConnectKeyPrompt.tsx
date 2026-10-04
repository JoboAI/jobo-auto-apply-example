import Link from 'next/link'
import { KeyRound } from 'lucide-react'

/**
 * Shown in place of jobs until the visitor connects their own Jobo API key.
 * No redirect(): inside the streamed (product) group it could only happen
 * client-side. Signed-in visitors without a key are sent to /onboarding from
 * / instead (app/page.tsx).
 */
export function ConnectKeyPrompt() {
  return (
    <div className="empty-state">
      <KeyRound size={30} />
      <h1>Connect your Jobo API key.</h1>
      <p>
        Every search and application in this demo runs on your own key: a sandbox key for fictional
        jobs, or a production key for real ones.
      </p>
      <Link href="/onboarding" className="button primary">
        Connect your key
      </Link>
    </div>
  )
}
