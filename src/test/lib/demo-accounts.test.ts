import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getDevDemoAccounts } from '@/lib/auth/demo-accounts'

const ORIGINAL_NODE_ENV = process.env.NODE_ENV

function setNodeEnv(value: string | undefined) {
  Object.assign(process.env, { NODE_ENV: value })
}

afterEach(() => {
  setNodeEnv(ORIGINAL_NODE_ENV)
  delete process.env.DEMO_ADMIN_EMAIL
  delete process.env.DEMO_ADMIN_PASSWORD
  delete process.env.DEMO_VENDOR_EMAIL
  delete process.env.DEMO_VENDOR_PASSWORD
})

describe('getDevDemoAccounts', () => {
  it('returns nothing outside development even when demo env is set', () => {
    setNodeEnv('production')
    process.env.DEMO_ADMIN_EMAIL = 'admin@example.com'
    process.env.DEMO_ADMIN_PASSWORD = 'password123'
    process.env.DEMO_VENDOR_EMAIL = 'gorce@vendor.com'
    process.env.DEMO_VENDOR_PASSWORD = 'password123'
    expect(getDevDemoAccounts()).toEqual([])
  })

  it('reads server env only in development and skips incomplete pairs', () => {
    setNodeEnv('development')
    process.env.DEMO_ADMIN_EMAIL = 'dev-admin@example.test'
    process.env.DEMO_ADMIN_PASSWORD = 'dev-only-secret'
    process.env.DEMO_VENDOR_EMAIL = 'vendor-only@example.test'
    delete process.env.DEMO_VENDOR_PASSWORD
    expect(getDevDemoAccounts()).toEqual([
      {
        role: 'Admin',
        email: 'dev-admin@example.test',
        password: 'dev-only-secret',
        description: 'Full system access',
      },
    ])
  })
})

describe('login client bundle sources', () => {
  it('does not hardcode demo emails or passwords', () => {
    const files = ['app/login/page.tsx', 'app/login/login-form.tsx', 'lib/auth/demo-accounts.ts']
    for (const file of files) {
      const src = readFileSync(resolve(file), 'utf8')
      expect(src, file).not.toContain('admin@example.com')
      expect(src, file).not.toContain('gorce@vendor.com')
      expect(src, file).not.toContain('password123')
      expect(src, file).not.toContain('NEXT_PUBLIC_ENABLE_DEMO_LOGIN')
      expect(src, file).not.toContain('NEXT_PUBLIC_')
    }
  })
})
