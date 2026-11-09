import { Suspense } from 'react'
import { getDevDemoAccounts } from '@/lib/auth/demo-accounts'
import { LoginForm, LoginPageFallback } from './login-form'

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginPageFallback />}>
      <LoginForm demoAccounts={getDevDemoAccounts()} />
    </Suspense>
  )
}
