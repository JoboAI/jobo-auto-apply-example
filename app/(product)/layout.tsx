import { requireUser } from '@/lib/session'
import { getDemoSettings } from '@/lib/user-settings'
import { AppShell } from '@/components/AppShell'
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const settings = await getDemoSettings(user.id)
  return (
    <AppShell name={user.name} email={user.email} settings={settings}>
      {children}
    </AppShell>
  )
}
