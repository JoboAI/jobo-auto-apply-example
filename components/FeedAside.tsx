import Link from 'next/link'
import { ArrowRight, ArrowUpRight, BriefcaseBusiness, Check, Sparkles } from 'lucide-react'
import { ApiDocsLink, SourceLink } from './SourceLink'

/** The sandbox feed's side column: integration pointers, profile status, activity. */
export function FeedAside({
  name,
  profileReady,
  production,
  applicationCount,
  submittedCount,
}: {
  name: string
  profileReady: boolean
  production: boolean
  applicationCount: number
  submittedCount: number
}) {
  return (
    <aside className="feed-aside">
      <div className="aside-card integration-help">
        <span className="eyebrow">BUILD YOUR INTEGRATION</span>
        <h3>Your data. Jobo’s form automation.</h3>
        <p>
          The API returns typed fields and fills the form. Your app supplies the answers; this demo
          uses profile data and OpenRouter.
        </p>
        <ApiDocsLink />
        <SourceLink />
      </div>
      <div className="aside-card">
        <span className="eyebrow">TEST CANDIDATE PROFILE</span>
        <div className="profile-ring">
          <span>{name.slice(0, 1).toUpperCase()}</span>
          {profileReady && (
            <i>
              <Check size={12} />
            </i>
          )}
        </div>
        <h3>{profileReady ? 'Ready to test Auto Apply.' : 'Set up your test data.'}</h3>
        <p>
          {profileReady
            ? 'Your confirmed profile supplies the facts used to answer application fields.'
            : 'Upload and review a resume before running a sandbox application.'}
        </p>
        <Link href="/profiles" className="button secondary full-width">
          {profileReady ? 'View my profile' : 'Complete profile'}
          <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="aside-card activity-card">
        <div className="section-heading">
          <h3>Demo activity</h3>
          <BriefcaseBusiness size={18} />
        </div>
        <div className="metric">
          <strong>{applicationCount}</strong>
          <span>Applications started</span>
        </div>
        <div className="metric">
          <strong>{submittedCount}</strong>
          <span>Successfully submitted</span>
        </div>
        <Link className="text-link" href="/applications">
          View applications <ArrowRight size={15} />
        </Link>
      </div>
      <div className="quiet-note">
        <Sparkles size={16} />
        <p>
          {production
            ? 'Production mode calls the Jobs and Auto Apply APIs with your own key — the same calls your integration would make.'
            : 'This demo calls the Auto Apply API against fictional jobs. Use the source to see how to integrate it into your own app.'}
        </p>
      </div>
    </aside>
  )
}
