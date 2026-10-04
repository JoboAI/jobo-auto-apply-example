import Link from 'next/link'
import { ArrowUpRight, TriangleAlert } from 'lucide-react'
import {
  API_KEYS_URL,
  AUTO_APPLY_ACCESS_URL,
  accessReason,
  type AccessProblem,
} from '@/lib/presentation'

/**
 * Jobo refused to start an application because the key's account cannot use
 * Auto Apply yet (no access, agreement not accepted, or business review not
 * approved). Shown where the visitor applied: the application page and the
 * job card. A production key gets the way out — the sandbox works on any
 * account; a sandbox key (which should not hit this) gets the API's detail
 * and where to sort out access.
 */
export function AccessProblemNotice({ problem }: { problem: AccessProblem }) {
  const reason = accessReason(problem.detail)
  return (
    <div className="notice warning access-problem" role="note">
      <TriangleAlert size={18} />
      <div>
        {problem.sandbox ? (
          <p>
            <strong>Jobo refused this sandbox application:</strong> {reason}.
          </p>
        ) : (
          <p>
            <strong>Your production key’s account can’t use Auto Apply yet:</strong> {reason}.
            Switch to a sandbox key to try the full flow.
          </p>
        )}
        <div className="access-problem-actions">
          {problem.sandbox ? (
            <a
              href={AUTO_APPLY_ACCESS_URL}
              className="text-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              Auto Apply access in Jobo <ArrowUpRight size={14} />
            </a>
          ) : (
            <Link href="/settings#api-key" className="button primary small">
              Use a sandbox key
            </Link>
          )}
          <a href={API_KEYS_URL} className="text-link" target="_blank" rel="noopener noreferrer">
            Create a sandbox key in Jobo → API Keys <ArrowUpRight size={14} />
          </a>
        </div>
      </div>
    </div>
  )
}
