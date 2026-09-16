import { describe, expect, it, afterEach, vi } from 'vitest'
import { getAuthSecret } from '@/lib/auth/config'

describe('getAuthSecret', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('allows dev default when not in production', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('AUTH_SECRET', '')
    expect(() => getAuthSecret()).not.toThrow()
  })

  it('throws in production when AUTH_SECRET is missing', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AUTH_SECRET', '')
    expect(() => getAuthSecret()).toThrow(/AUTH_SECRET/)
  })
})
