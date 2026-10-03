import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowUpRight, ArrowRight, Check, Sparkles } from 'lucide-react'
import { ApplicationFlowGraphic, IntegrationGraphic } from '@/components/ApplicationFlowGraphic'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { profiles } from '@/db/schema'
import { currentUser } from '@/lib/session'
import { ApiDocsLink, SourceLink } from '@/components/SourceLink'
export default async function Home() {
  // Signed-in visitors go straight to the app: onboarding until they have a
  // profile. Decided here, outside the (product) group, because a redirect()
  // inside it happens after streaming starts and can only be done client-side.
  const user = await currentUser()
  if (user) {
    const [profile] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.userId, user.id), eq(profiles.archived, false)))
      .limit(1)
    redirect(profile ? '/jobs' : '/onboarding')
  }
  return (
    <div className="landing">
      <header className="landing-nav">
        <Link className="logo" href="/">
          <img src="/logos/jobo-logo.svg" alt="Jobo" />
        </Link>
        <span className="sandbox-pill">
          <span />
          Auto Apply Demo
        </span>
        <SourceLink compact />
        <Link href="/login" className="button secondary">
          Log in <ArrowUpRight size={16} />
        </Link>
      </header>
      <main className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <Sparkles size={16} /> JOBO AUTO APPLY API · DEVELOPER DEMO
          </div>
          <h1>
            Your app. Our API.
            <br />
            <em>Applications, automated.</em>
          </h1>
          <p>
            See what you can build with the Auto Apply API. Upload a resume, click Apply on a
            sandbox job, and follow every step through to submission. Then explore the code and
            build it into your app.
          </p>
          <div className="hero-actions">
            <Link href="/signup" className="button primary large">
              Try Auto Apply <ArrowRight size={18} />
            </Link>
            <ApiDocsLink />
          </div>
          <div className="hero-footnote">
            <Check size={15} /> Sandbox jobs by default. Real API calls. Real employers only in
            production mode, on your own key.
          </div>
        </div>
        <ApplicationFlowGraphic />
      </main>
      <section className="landing-steps">
        {[
          {
            n: '01',
            graphic: 'profile' as const,
            title: 'Prepare candidate data',
            text: 'Upload a resume and confirm the facts used to answer fields.',
          },
          {
            n: '02',
            graphic: 'application' as const,
            title: 'Run a sandbox application',
            text: 'Click Apply and watch the create, answer, and submit flow.',
          },
          {
            n: '03',
            graphic: 'integration' as const,
            title: 'Build it into your app',
            text: 'Explore the working integration on GitHub and adapt it to your product.',
          },
        ].map(({ n, graphic, title, text }) => (
          <div key={n}>
            <span className="step-number">{n}</span>
            <IntegrationGraphic kind={graphic} />
            <h3>{title}</h3>
            <p>{text}</p>
          </div>
        ))}
      </section>
      <section className="integration-boundary">
        <div>
          <span className="eyebrow">YOUR APP</span>
          <h3>You own the candidate experience.</h3>
          <p>
            Profiles, resumes, and answer generation live in your app. This example uses reviewed
            profile data and OpenRouter for generated answers.
          </p>
        </div>
        <div>
          <span className="eyebrow">AUTO APPLY API</span>
          <h3>Jobo handles the application form.</h3>
          <p>
            Send an application URL, receive typed fields, and return your answers. The API fills
            the form and returns the next step or final result.
          </p>
        </div>
      </section>
      <footer className="landing-footer">
        <span>Jobo Auto Apply Demo · Sandbox and production modes. Real application flows.</span>
        <div className="developer-links">
          <ApiDocsLink />
          <SourceLink />
        </div>
      </footer>
    </div>
  )
}
