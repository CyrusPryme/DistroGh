// ─── Module catalogue ─────────────────────────────────────────────────────────
// Single source-of-truth for all modules and their allowed actions.
// Keep in sync with db/migrations/019_rbac.sql.

export const PERMISSION_ACTIONS = [
  'read',
  'create',
  'update',
  'delete',
  'export',
  'approve',
  'manage',
] as const

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number]

export interface ModuleDefinition {
  key: string
  label: string
  group: string
  actions: PermissionAction[]
}

export const MODULES: ModuleDefinition[] = [
  // ── Core Operations ──────────────────────────────────────────────────────
  { key: 'dashboard',             label: 'Dashboard',              group: 'Core',         actions: ['read', 'export'] },
  { key: 'vendors',               label: 'Vendors',                group: 'Core',         actions: ['read','create','update','delete','export','approve'] },
  { key: 'products',              label: 'Products',               group: 'Core',         actions: ['read','create','update','delete','export'] },
  { key: 'categories',            label: 'Categories',             group: 'Core',         actions: ['read','create','update','delete'] },
  { key: 'sales',                 label: 'Sales',                  group: 'Core',         actions: ['read','create','update','delete','export'] },
  { key: 'sales_import',          label: 'Sales Import',           group: 'Core',         actions: ['read','create','update','delete','export'] },
  { key: 'returns',               label: 'Returns',                group: 'Core',         actions: ['read','create','update','delete','export'] },
  { key: 'receiving',             label: 'Receiving',              group: 'Core',         actions: ['read','create','update','delete','export'] },
  { key: 'deliveries',            label: 'Deliveries',             group: 'Core',         actions: ['read','create','update','delete','export','approve'] },
  { key: 'supermarkets',          label: 'Supermarkets',           group: 'Core',         actions: ['read','create','update','delete','export'] },
  { key: 'store_stock',           label: 'Store Stock',            group: 'Core',         actions: ['read','export'] },

  // ── Finance ───────────────────────────────────────────────────────────────
  { key: 'payouts',               label: 'Payouts',                group: 'Finance',      actions: ['read','create','update','delete','export','approve'] },
  { key: 'deductions',            label: 'Deductions',             group: 'Finance',      actions: ['read','create','update','delete','export'] },
  { key: 'reports',               label: 'Reports',                group: 'Finance',      actions: ['read','export'] },

  // ── Vendor Management ─────────────────────────────────────────────────────
  { key: 'vendor_applications',   label: 'Vendor Applications',    group: 'Vendors',      actions: ['read','create','update','delete','export','approve'] },
  { key: 'deactivation_requests', label: 'Deactivation Requests',  group: 'Vendors',      actions: ['read','create','update','delete','export','approve'] },
  { key: 'vendor_documents',      label: 'Vendor Documents',       group: 'Vendors',      actions: ['read','create','update','delete','export'] },
  { key: 'service_charges',       label: 'Service Charges',        group: 'Vendors',      actions: ['read','create','update','approve'] },

  // ── System ────────────────────────────────────────────────────────────────
  { key: 'settings',              label: 'Settings',               group: 'System',       actions: ['read','create','update','delete'] },
  { key: 'support',               label: 'Support',                group: 'System',       actions: ['read','create','update','delete'] },

  // ── Administration (super_admin only) ────────────────────────────────────
  { key: 'admin_accounts',        label: 'Admin Accounts',         group: 'Admin',        actions: ['read','create','update','delete','manage'] },
  { key: 'roles_permissions',     label: 'Roles & Permissions',    group: 'Admin',        actions: ['read','create','update','delete','manage'] },
  { key: 'audit_logs',            label: 'Audit Logs',             group: 'Admin',        actions: ['read','export'] },
]

export const MODULE_MAP: Record<string, ModuleDefinition> = Object.fromEntries(
  MODULES.map((m) => [m.key, m])
)

// ─── Permission key helpers ───────────────────────────────────────────────────

/** Compact permission key: "module:action" */
export function permKey(module: string, action: string): string {
  return `${module}:${action}`
}

/** Parse a compact key back to parts. */
export function parsePermKey(key: string): { module: string; action: string } {
  const [module, action] = key.split(':')
  return { module, action }
}

// ─── Runtime permission check ────────────────────────────────────────────────

/** Full role hierarchy: developer > super_admin > admin > user */
export type AdminRole = 'developer' | 'super_admin' | 'admin' | 'user'

/** Roles that bypass all permission checks (implicit all-access). */
export const ELEVATED_ROLES: AdminRole[] = ['developer', 'super_admin']

export interface PermissionContext {
  admin_role?: AdminRole | null
  permissions?: string[] | null
}

/**
 * Returns true if the context holder is allowed to perform `action` on `module`.
 * super_admin always passes. Others must have the key in their permissions list.
 */
export function hasPermission(
  ctx: PermissionContext,
  module: string,
  action: PermissionAction
): boolean {
  if (ctx.admin_role === 'developer' || ctx.admin_role === 'super_admin') return true
  if (!ctx.permissions) return false
  return ctx.permissions.includes(permKey(module, action))
}

/**
 * Throws a Forbidden error if the context holder lacks the given permission.
 */
export function assertPermission(
  ctx: PermissionContext,
  module: string,
  action: PermissionAction
): void {
  if (!hasPermission(ctx, module, action)) {
    throw new Error('Forbidden')
  }
}

// ─── Role preset templates ────────────────────────────────────────────────────

export interface RolePreset {
  id: string
  label: string
  description: string
  permissions: string[]
}

const _allAdminPerms = MODULES.filter((m) => m.group !== 'Admin').flatMap((m) =>
  m.actions.map((a) => permKey(m.key, a))
)

export const ROLE_PRESETS: RolePreset[] = [
  {
    id: 'full_admin',
    label: 'Full Admin',
    description: 'Complete access to all non-administration modules.',
    permissions: _allAdminPerms,
  },
  {
    id: 'operations_admin',
    label: 'Operations Admin',
    description: 'Manage vendors, products, receiving, deliveries, and supermarkets.',
    permissions: [
      'dashboard:read',
      'vendors:read','vendors:create','vendors:update','vendors:export',
      'products:read','products:create','products:update','products:delete','products:export',
      'categories:read','categories:create','categories:update','categories:delete',
      'receiving:read','receiving:create','receiving:update','receiving:delete','receiving:export',
      'deliveries:read','deliveries:create','deliveries:update','deliveries:approve','deliveries:export',
      'supermarkets:read','supermarkets:create','supermarkets:update','supermarkets:export',
      'store_stock:read','store_stock:export',
      'returns:read','returns:create','returns:update','returns:export',
      'support:read','support:create',
    ],
  },
  {
    id: 'finance_admin',
    label: 'Finance Admin',
    description: 'Handle payouts, deductions, and financial reports.',
    permissions: [
      'dashboard:read',
      'vendors:read','vendors:export',
      'payouts:read','payouts:create','payouts:update','payouts:approve','payouts:export',
      'deductions:read','deductions:create','deductions:update','deductions:export',
      'sales:read','sales:export',
      'reports:read','reports:export',
      'service_charges:read','service_charges:create','service_charges:update','service_charges:approve',
      'support:read','support:create',
    ],
  },
  {
    id: 'sales_admin',
    label: 'Sales Admin',
    description: 'Manage sales, imports, and reporting.',
    permissions: [
      'dashboard:read',
      'sales:read','sales:create','sales:update','sales:delete','sales:export',
      'sales_import:read','sales_import:create','sales_import:export',
      'returns:read','returns:create','returns:update','returns:export',
      'vendors:read','vendors:export',
      'products:read','products:export',
      'supermarkets:read',
      'store_stock:read',
      'reports:read','reports:export',
      'support:read','support:create',
    ],
  },
  {
    id: 'read_only_user',
    label: 'Read Only User',
    description: 'View-only access to core modules.',
    permissions: [
      'dashboard:read',
      'sales:read',
      'reports:read','reports:export',
      'supermarkets:read',
      'store_stock:read',
      'support:read','support:create',
    ],
  },
]
