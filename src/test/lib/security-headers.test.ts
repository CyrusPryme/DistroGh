import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const nextConfig = require('../../../next.config.js')

describe('security headers', () => {
  it('sets an enforcing CSP and baseline headers without wildcard CORS', async () => {
    const groups = await nextConfig.headers()
    const headers = groups.flatMap((group: { headers: { key: string; value: string }[] }) => group.headers)
    const byKey = Object.fromEntries(headers.map((header: { key: string; value: string }) => [header.key, header.value]))

    expect(byKey['X-Frame-Options']).toBe('DENY')
    expect(byKey['X-Content-Type-Options']).toBe('nosniff')
    expect(byKey['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(byKey['Permissions-Policy']).toContain('camera=()')
    expect(byKey['Permissions-Policy']).toContain('microphone=()')
    expect(byKey['Permissions-Policy']).toContain('geolocation=()')

    const csp = byKey['Content-Security-Policy']
    expect(csp).toBeTruthy()
    expect(csp.startsWith('Content-Security-Policy-Report-Only')).toBe(false)
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain('https://fonts.googleapis.com')
    expect(csp).toContain('https://fonts.gstatic.com')
    expect(csp).toContain("img-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toContain('Report-Only')

    const keys = headers.map((header: { key: string }) => header.key.toLowerCase())
    expect(keys).not.toContain('access-control-allow-origin')
  })
})
