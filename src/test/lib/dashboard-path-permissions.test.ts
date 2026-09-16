import { describe, expect, it } from 'vitest'
import {
  adminCanAccessDashboardPath,
  adminDashboardReadModule,
} from '@/lib/auth/dashboard-path-permissions'

describe('dashboard path permissions', () => {
  it('maps deliveries and products paths to modules', () => {
    expect(adminDashboardReadModule('/dashboard/deliveries')).toBe('deliveries')
    expect(adminDashboardReadModule('/dashboard/products/abc')).toBe('products')
    expect(adminDashboardReadModule('/dashboard/reports')).toBeNull()
  })

  it('denies restricted admin without module read', () => {
    expect(
      adminCanAccessDashboardPath(
        { admin_role: 'user', permissions: ['sales:read'] },
        '/dashboard/deliveries'
      )
    ).toBe(false)
    expect(
      adminCanAccessDashboardPath(
        { admin_role: 'user', permissions: ['deliveries:read'] },
        '/dashboard/deliveries'
      )
    ).toBe(true)
  })

  it('allows elevated admin roles', () => {
    expect(
      adminCanAccessDashboardPath({ admin_role: 'super_admin', permissions: [] }, '/dashboard/deliveries')
    ).toBe(true)
  })
})
