import { requireUser } from '@/lib/session'
import { AccountSettings } from '@/components/AccountSettings'
export default async function Page() {
  const user = await requireUser()
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE YOURSELF AT HOME</div>
          <h1>Account settings.</h1>
          <p>A few details, all in your control.</p>
        </div>
      </div>
      <AccountSettings name={user.name} email={user.email} />
    </>
  )
}
