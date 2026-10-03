import Link from 'next/link'
import { ArrowRight, ArrowUpRight, BookOpen, Check, Sparkles } from 'lucide-react'
import { SourceLink } from './SourceLink'

/** The job feed's heading and banner: sandbox, production or saved jobs. */
export function FeedHeader({
  savedOnly,
  production,
  explorer,
  profileReady,
}: {
  savedOnly: boolean
  production: boolean
  /** Production search with the faceted explorer. */
  explorer: boolean
  profileReady: boolean
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {savedOnly
              ? 'SAVED JOBS'
              : production
                ? 'PRODUCTION · REAL JOBS ON YOUR API KEY'
                : 'JOBO AUTO APPLY API · INTERACTIVE DEMO'}
          </div>
          <h1>
            {savedOnly
              ? 'Saved jobs.'
              : production
                ? 'Apply to real jobs.'
                : 'See Auto Apply in action.'}
          </h1>
          <p>
            {savedOnly
              ? 'Pick up where you left off and apply with one click.'
              : production
                ? 'Live Jobo jobs on ATSes Auto Apply supports. Apply runs on your own API key and submits to the employer.'
                : 'Click Apply on a sandbox job and watch the API complete its application flow.'}
          </p>
        </div>
        <span className="soft-label">
          <Sparkles size={14} /> Built for developers
        </span>
      </div>
      {!savedOnly && (
        <section className="discovery-banner">
          {explorer ? (
            <div>
              <span className="eyebrow">JOBS API · LIVE CATALOG</span>
              <h2>
                Slice real jobs any way you like.
                <br />
                Every filter is one API call.
              </h2>
              <p>
                Filter by company, industry, business model, seniority, salary and skills, with live
                facet counts. Each job also carries an enriched company profile. Open “See the API
                call” to copy the request.
              </p>
              <a
                href="https://jobo.world/docs/guides/search-recipes"
                className="text-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                <BookOpen size={16} /> Search recipes &amp; facets docs <ArrowUpRight size={16} />
              </a>
              <SourceLink />
            </div>
          ) : (
            <div>
              <span className="eyebrow">FROM DEMO TO YOUR APP</span>
              <h2>
                An Apply button.
                <br />
                An API behind every step.
              </h2>
              <p>
                Explore how this app creates applications, answers discovered fields, and tracks
                results with the Auto Apply API.
              </p>
              <Link href="/profiles" className="text-link">
                {profileReady ? 'Review test profile' : 'Set up a test profile'}{' '}
                <ArrowRight size={16} />
              </Link>
              <SourceLink />
            </div>
          )}
          <div className="banner-illustration" aria-hidden="true">
            <div className="paper paper-back" />
            <div className="paper paper-front">
              <div className="paper-head">
                <span />
                <i />
              </div>
              <div className="paper-line" />
              <div className="paper-line short" />
              <div className="paper-line" />
              <div className="paper-line short" />
              <div className="paper-stamp">
                <Check size={24} />
              </div>
            </div>
            <div className="sparkle-one">✧</div>
            <div className="sparkle-two">✧</div>
          </div>
        </section>
      )}
    </>
  )
}
