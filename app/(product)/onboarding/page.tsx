import type { Metadata } from 'next'
import { ResumeUpload } from '@/components/ResumeUpload'
import { OnboardingKeyForm } from '@/components/ApiKeyForm'
import { requireUser } from '@/lib/session'
import { getKeySettings } from '@/lib/user-settings'

export const metadata: Metadata = { title: 'Get started' }
export default async function Page() {
  const user = await requireUser()
  const settings = await getKeySettings(user.id)
  // Every Jobo call this app makes for the visitor uses their own key, so it
  // comes first; then the resume.
  const step = settings.mode ? 2 : 1
  return (
    <div className="onboarding">
      <div className="eyebrow">SET UP YOUR TEST CANDIDATE</div>
      <h1>Welcome, {user.name.split(' ')[0]}.</h1>
      {step === 1 ? (
        <p>
          Connect your Jobo API key. Every search and application in this demo runs on it, in your
          own Jobo account.
        </p>
      ) : (
        <p>
          Upload a resume to try the integration. Review the extracted profile before the demo uses
          it to answer application fields.
        </p>
      )}
      <ol className="onboarding-steps">
        {[
          'Connect your Jobo API key',
          'Upload resume',
          'Review your profile',
          'Test Auto Apply',
        ].map((label, i) => (
          <li key={label} className={i + 1 === step ? 'current' : ''}>
            <span>{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {step === 1 ? (
        <section className="surface settings-card">
          <h2>Connect your Jobo API key</h2>
          <OnboardingKeyForm acknowledged={settings.acknowledged} />
        </section>
      ) : (
        <>
          <ResumeUpload />
          <p className="onboarding-footnote">
            Your resume stays private to your account. Applying shares a saved copy with the
            application form.
          </p>
        </>
      )}
    </div>
  )
}
