import type { Metadata } from 'next'
import { AuthForm } from '@/components/AuthForm'

export const metadata: Metadata = { title: 'Reset your password' }
export default function Page() {
  return <AuthForm mode="forgot" />
}
