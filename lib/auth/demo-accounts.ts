/**
 * Dev-only login shortcuts. Import this from Server Components only.
 * Credentials come from server env (DEMO_ADMIN_EMAIL and related) and are
 * omitted entirely outside development, so production client bundles cannot
 * contain them. Do not prefix these variables for the browser.
 */
export type DemoLoginAccount = {
  role: string
  email: string
  password: string
  description: string
}

function accountFromEnv(
  role: string,
  description: string,
  emailEnv: string | undefined,
  passwordEnv: string | undefined
): DemoLoginAccount | null {
  const email = emailEnv?.trim() ?? ''
  const password = passwordEnv ?? ''
  if (!email || !password.trim()) return null
  return { role, email, password, description }
}

export function getDevDemoAccounts(): DemoLoginAccount[] {
  if (process.env.NODE_ENV !== 'development') return []

  return [
    accountFromEnv(
      'Admin',
      'Full system access',
      process.env.DEMO_ADMIN_EMAIL,
      process.env.DEMO_ADMIN_PASSWORD
    ),
    accountFromEnv(
      'Vendor',
      'Vendor portal',
      process.env.DEMO_VENDOR_EMAIL,
      process.env.DEMO_VENDOR_PASSWORD
    ),
  ].filter((account): account is DemoLoginAccount => account !== null)
}
