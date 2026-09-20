import { hasPermission, type PermissionContext } from '@/lib/auth/permissions'

/** Non-elevated admins need module:read to open these dashboard routes (vendors use separate allowlists). */
export const ADMIN_DASHBOARD_READ_PATHS: { prefix: string; module: string }[] = [
  { prefix: '/dashboard/deliveries', module: 'deliveries' },
  { prefix: '/dashboard/products', module: 'products' },
  { prefix: '/dashboard/returns', module: 'returns' },
  { prefix: '/dashboard/payouts', module: 'payouts' },
]

export function adminDashboardReadModule(pathname: string): string | null {
  for (const { prefix, module: moduleName } of ADMIN_DASHBOARD_READ_PATHS) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return moduleName
  }
  return null
}

export function adminCanAccessDashboardPath(ctx: PermissionContext, pathname: string): boolean {
  const moduleName = adminDashboardReadModule(pathname)
  if (!moduleName) return true
  return hasPermission(ctx, moduleName, 'read')
}
