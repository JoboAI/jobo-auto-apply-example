import { requireUser } from '@/lib/session'
import { AppShell } from '@/components/AppShell'
export default async function Layout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireUser()
  return (
    <AppShell name={user.name} email={user.email}>
      {children}
    </AppShell>
  )
}
