-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 019: Role-Based Access Control (RBAC)
-- Creates: roles, permissions, role_permissions, admin_profiles,
--          admin_user_permissions, audit_logs
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Roles ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.roles (
  id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system_role BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.roles (name, description, is_system_role) VALUES
  ('super_admin', 'Full system access. Can manage admin accounts and all permissions.', true),
  ('admin',       'Standard administrator with configurable module-level permissions.',  true),
  ('user',        'Staff member with limited read/write access per assigned permissions.', true),
  ('vendor',      'Vendor with access to their own data only.',                          true)
ON CONFLICT (name) DO NOTHING;

-- ─── 2. Permissions (module × action catalogue) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.permissions (
  id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  module TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('read','create','update','delete','export','approve','manage')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (module, action)
);

-- Seed every module × action combination the system needs.
-- Modules discovered from codebase scan + spec requirements.
INSERT INTO public.permissions (module, action) VALUES
  -- Dashboard / Analytics
  ('dashboard',             'read'),
  ('dashboard',             'export'),

  -- Vendors
  ('vendors',               'read'),
  ('vendors',               'create'),
  ('vendors',               'update'),
  ('vendors',               'delete'),
  ('vendors',               'export'),
  ('vendors',               'approve'),

  -- Vendor Applications
  ('vendor_applications',   'read'),
  ('vendor_applications',   'create'),
  ('vendor_applications',   'update'),
  ('vendor_applications',   'delete'),
  ('vendor_applications',   'export'),
  ('vendor_applications',   'approve'),

  -- Deactivation Requests
  ('deactivation_requests', 'read'),
  ('deactivation_requests', 'create'),
  ('deactivation_requests', 'update'),
  ('deactivation_requests', 'delete'),
  ('deactivation_requests', 'export'),
  ('deactivation_requests', 'approve'),

  -- Vendor Documents (FDA certs)
  ('vendor_documents',      'read'),
  ('vendor_documents',      'create'),
  ('vendor_documents',      'update'),
  ('vendor_documents',      'delete'),
  ('vendor_documents',      'export'),

  -- Service Charges (annual vendor fee)
  ('service_charges',       'read'),
  ('service_charges',       'create'),
  ('service_charges',       'update'),
  ('service_charges',       'approve'),

  -- Products
  ('products',              'read'),
  ('products',              'create'),
  ('products',              'update'),
  ('products',              'delete'),
  ('products',              'export'),

  -- Categories
  ('categories',            'read'),
  ('categories',            'create'),
  ('categories',            'update'),
  ('categories',            'delete'),

  -- Sales
  ('sales',                 'read'),
  ('sales',                 'create'),
  ('sales',                 'update'),
  ('sales',                 'delete'),
  ('sales',                 'export'),

  -- Sales Import
  ('sales_import',          'read'),
  ('sales_import',          'create'),
  ('sales_import',          'update'),
  ('sales_import',          'delete'),
  ('sales_import',          'export'),

  -- Returns
  ('returns',               'read'),
  ('returns',               'create'),
  ('returns',               'update'),
  ('returns',               'delete'),
  ('returns',               'export'),

  -- Receiving (stock intakes)
  ('receiving',             'read'),
  ('receiving',             'create'),
  ('receiving',             'update'),
  ('receiving',             'delete'),
  ('receiving',             'export'),

  -- Deliveries
  ('deliveries',            'read'),
  ('deliveries',            'create'),
  ('deliveries',            'update'),
  ('deliveries',            'delete'),
  ('deliveries',            'export'),
  ('deliveries',            'approve'),

  -- Supermarkets
  ('supermarkets',          'read'),
  ('supermarkets',          'create'),
  ('supermarkets',          'update'),
  ('supermarkets',          'delete'),
  ('supermarkets',          'export'),

  -- Store Stock
  ('store_stock',           'read'),
  ('store_stock',           'export'),

  -- Payouts
  ('payouts',               'read'),
  ('payouts',               'create'),
  ('payouts',               'update'),
  ('payouts',               'delete'),
  ('payouts',               'export'),
  ('payouts',               'approve'),

  -- Deductions
  ('deductions',            'read'),
  ('deductions',            'create'),
  ('deductions',            'update'),
  ('deductions',            'delete'),
  ('deductions',            'export'),

  -- Reports
  ('reports',               'read'),
  ('reports',               'export'),

  -- Settings
  ('settings',              'read'),
  ('settings',              'create'),
  ('settings',              'update'),
  ('settings',              'delete'),

  -- Support
  ('support',               'read'),
  ('support',               'create'),
  ('support',               'update'),
  ('support',               'delete'),

  -- Administration (super_admin only)
  ('admin_accounts',        'read'),
  ('admin_accounts',        'create'),
  ('admin_accounts',        'update'),
  ('admin_accounts',        'delete'),
  ('admin_accounts',        'manage'),

  ('roles_permissions',     'read'),
  ('roles_permissions',     'create'),
  ('roles_permissions',     'update'),
  ('roles_permissions',     'delete'),
  ('roles_permissions',     'manage'),

  ('audit_logs',            'read'),
  ('audit_logs',            'export')

ON CONFLICT (module, action) DO NOTHING;

-- ─── 3. Role → default permission templates ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_id       UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role_id, permission_id)
);

-- Helper: bulk-assign permissions to a role by name
DO $$
DECLARE
  r_admin   UUID := (SELECT id FROM public.roles WHERE name = 'admin');
  r_user    UUID := (SELECT id FROM public.roles WHERE name = 'user');
BEGIN
  -- ADMIN default: everything except admin_accounts / roles_permissions / audit_logs manage
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r_admin, p.id
  FROM public.permissions p
  WHERE (p.module, p.action) IN (
    -- dashboard
    ('dashboard','read'), ('dashboard','export'),
    -- vendors
    ('vendors','read'),('vendors','create'),('vendors','update'),('vendors','delete'),('vendors','export'),('vendors','approve'),
    -- vendor_applications
    ('vendor_applications','read'),('vendor_applications','create'),('vendor_applications','update'),
    ('vendor_applications','delete'),('vendor_applications','export'),('vendor_applications','approve'),
    -- deactivation_requests
    ('deactivation_requests','read'),('deactivation_requests','create'),('deactivation_requests','update'),
    ('deactivation_requests','delete'),('deactivation_requests','export'),('deactivation_requests','approve'),
    -- vendor_documents
    ('vendor_documents','read'),('vendor_documents','create'),('vendor_documents','update'),
    ('vendor_documents','delete'),('vendor_documents','export'),
    -- service_charges
    ('service_charges','read'),('service_charges','create'),('service_charges','update'),('service_charges','approve'),
    -- products
    ('products','read'),('products','create'),('products','update'),('products','delete'),('products','export'),
    -- categories
    ('categories','read'),('categories','create'),('categories','update'),('categories','delete'),
    -- sales
    ('sales','read'),('sales','create'),('sales','update'),('sales','delete'),('sales','export'),
    -- sales_import
    ('sales_import','read'),('sales_import','create'),('sales_import','update'),('sales_import','delete'),('sales_import','export'),
    -- returns
    ('returns','read'),('returns','create'),('returns','update'),('returns','delete'),('returns','export'),
    -- receiving
    ('receiving','read'),('receiving','create'),('receiving','update'),('receiving','delete'),('receiving','export'),
    -- deliveries
    ('deliveries','read'),('deliveries','create'),('deliveries','update'),('deliveries','delete'),('deliveries','export'),('deliveries','approve'),
    -- supermarkets
    ('supermarkets','read'),('supermarkets','create'),('supermarkets','update'),('supermarkets','delete'),('supermarkets','export'),
    -- store_stock
    ('store_stock','read'),('store_stock','export'),
    -- payouts
    ('payouts','read'),('payouts','create'),('payouts','update'),('payouts','delete'),('payouts','export'),('payouts','approve'),
    -- deductions
    ('deductions','read'),('deductions','create'),('deductions','update'),('deductions','delete'),('deductions','export'),
    -- reports
    ('reports','read'),('reports','export'),
    -- settings
    ('settings','read'),('settings','create'),('settings','update'),('settings','delete'),
    -- support
    ('support','read'),('support','create'),('support','update'),('support','delete')
  )
  ON CONFLICT (role_id, permission_id) DO NOTHING;

  -- USER default: read-only access to core modules
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r_user, p.id
  FROM public.permissions p
  WHERE (p.module, p.action) IN (
    ('dashboard','read'),
    ('sales','read'),
    ('reports','read'),('reports','export'),
    ('supermarkets','read'),
    ('store_stock','read'),
    ('support','read'),('support','create')
  )
  ON CONFLICT (role_id, permission_id) DO NOTHING;
END $$;

-- ─── 4. Admin profiles (extends users for admin/user roles) ───────────────────
CREATE TABLE IF NOT EXISTS public.admin_profiles (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  first_name   TEXT NOT NULL DEFAULT '',
  last_name    TEXT NOT NULL DEFAULT '',
  phone        TEXT,
  admin_role   TEXT NOT NULL DEFAULT 'admin'
                 CHECK (admin_role IN ('super_admin', 'admin', 'user')),
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'suspended')),
  notes        TEXT,
  last_login_at TIMESTAMPTZ,
  created_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_admin_profiles_admin_role   ON public.admin_profiles(admin_role);
CREATE INDEX IF NOT EXISTS idx_admin_profiles_status       ON public.admin_profiles(status);
CREATE INDEX IF NOT EXISTS idx_admin_profiles_deleted_at   ON public.admin_profiles(deleted_at) WHERE deleted_at IS NULL;

-- Backfill existing admin users (role = 'admin' in profiles) into admin_profiles.
-- They get admin_role = 'admin' and full admin permissions.
INSERT INTO public.admin_profiles (user_id, first_name, last_name, admin_role, status)
SELECT u.id, '', '', 'admin', 'active'
FROM public.users u
JOIN public.profiles p ON p.user_id = u.id
WHERE p.role = 'admin'
ON CONFLICT (user_id) DO NOTHING;

-- ─── 5. Per-user permission assignments ───────────────────────────────────────
-- Stores individual module+action grants per admin/user.
-- super_admin bypasses this table (all permissions implicit).
CREATE TABLE IF NOT EXISTS public.admin_user_permissions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  module       TEXT NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('read','create','update','delete','export','approve','manage')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, module, action)
);

CREATE INDEX IF NOT EXISTS idx_admin_user_permissions_user ON public.admin_user_permissions(user_id);

-- Backfill full admin permissions for all existing admin_profiles users.
INSERT INTO public.admin_user_permissions (user_id, module, action)
SELECT ap.user_id, p.module, p.action
FROM public.admin_profiles ap
CROSS JOIN public.permissions p
JOIN public.role_permissions rp ON rp.permission_id = p.id
JOIN public.roles r ON r.id = rp.role_id AND r.name = 'admin'
WHERE ap.admin_role = 'admin'
ON CONFLICT (user_id, module, action) DO NOTHING;

-- ─── 6. Audit logs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  actor_email  TEXT,
  action       TEXT NOT NULL,
  module       TEXT NOT NULL,
  target_id    TEXT,
  target_label TEXT,
  metadata     JSONB,
  ip_address   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id   ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_module      ON public.audit_logs(module);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action      ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at  ON public.audit_logs(created_at DESC);
