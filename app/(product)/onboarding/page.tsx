import type { Metadata } from 'next'
import { ResumeUpload } from '@/components/ResumeUpload'
import { requireUser } from '@/lib/session'

export const metadata: Metadata = { title: 'Set up your profile' }
export default async function Page() {
  const user = await requireUser()
  return (
    <div className="onboarding">
      <div className="eyebrow">SET UP YOUR TEST CANDIDATE</div>
      <h1>Welcome, {user.name.split(' ')[0]}.</h1>
      <p>
        Upload a resume to try the integration. Review the extracted profile before the demo uses it
        to answer sandbox application fields.
      </p>
      <ol className="onboarding-steps">
        <li className="current">
          <span>1</span>Upload resume
        </li>
        <li>
          <span>2</span>Review your profile
        </li>
        <li>
          <span>3</span>Test Auto Apply
        </li>
      </ol>
      <ResumeUpload />
      <p className="onboarding-footnote">
        Your resume stays private to your account. Applying shares a saved copy with the sandbox
        application form.
      </p>
    </div>
  )
}
