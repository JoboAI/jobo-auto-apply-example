import type { Metadata } from 'next'
import { requireUser } from '@/lib/session'
import { getKeySettings } from '@/lib/user-settings'
import { AccountSettings } from '@/components/AccountSettings'
import { ApiKeySettings } from '@/components/ApiKeySettings'

export const metadata: Metadata = { title: 'Settings' }
export default async function Page() {
  const user = await requireUser()
  const settings = await getKeySettings(user.id)
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE YOURSELF AT HOME</div>
          <h1>Account settings.</h1>
          <p>A few details, all in your control.</p>
        </div>
      </div>
      <div className="settings-stack">
        <ApiKeySettings {...settings} />
      </div>
      <AccountSettings name={user.name} email={user.email} />
    </>
  )
}
