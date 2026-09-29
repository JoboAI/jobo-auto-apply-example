import { AuthForm } from '@/components/AuthForm'
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  return <AuthForm mode="reset" token={(await searchParams).token} />
}
