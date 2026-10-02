import { requireUser } from '@/lib/session'
import { getDemoSettings } from '@/lib/user-settings'
import { AccountSettings } from '@/components/AccountSettings'
import { ProductionKeySettings } from '@/components/ModeToggle'
export default async function Page() {
  const user = await requireUser()
  const settings = await getDemoSettings(user.id)
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
        <ProductionKeySettings {...settings} />
      </div>
      <AccountSettings name={user.name} email={user.email} />
    </>
  )
}
