import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { MODULES, ROLE_PRESETS } from '@/lib/auth/permissions'

/**
 * GET /api/admin/roles
 * Returns:
 *  - modules catalogue
 *  - role_presets
 *  - role default permissions (from role_permissions table)
 */
export async function GET() {
  try {
    await requireSuperAdmin()
    const pool = getDbPool()

    // Load role default permissions
    const { rows } = await pool.query(
      `SELECT r.name as role_name, p.module, p.action
       FROM public.role_permissions rp
       JOIN public.roles r ON r.id = rp.role_id
       JOIN public.permissions p ON p.id = rp.permission_id
       ORDER BY r.name, p.module, p.action`
    )

    const roleDefaults: Record<string, string[]> = {}
    for (const row of rows) {
      if (!roleDefaults[row.role_name]) roleDefaults[row.role_name] = []
      roleDefaults[row.role_name].push(`${row.module}:${row.action}`)
    }

    return NextResponse.json({
      success: true,
      data: {
        modules: MODULES,
        presets: ROLE_PRESETS,
        role_defaults: roleDefaults,
      },
    })
  } catch (e) {
    return apiError(e, 'Failed to load roles')
  }
}
