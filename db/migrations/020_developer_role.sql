-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 020: Developer Role + Developer Charges Engine + Reconciliation
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Extend admin_profiles to accept 'developer' admin_role ────────────────
ALTER TABLE public.admin_profiles
  DROP CONSTRAINT IF EXISTS admin_profiles_admin_role_check;

ALTER TABLE public.admin_profiles
  ADD CONSTRAINT admin_profiles_admin_role_check
  CHECK (admin_role IN ('developer', 'super_admin', 'admin', 'user'));

-- ─── 2. Add 'developer' to system roles ──────────────────────────────────────
INSERT INTO public.roles (name, description, is_system_role)
VALUES ('developer', 'Platform owner. Unrestricted access to all modules including platform management.', true)
ON CONFLICT (name) DO NOTHING;

-- ─── 3. Developer fee configuration ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.developer_fee_configs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT NOT NULL,
  description    TEXT,
  fee_type       TEXT NOT NULL CHECK (fee_type IN ('percentage', 'fixed', 'hybrid')),
  percentage_rate NUMERIC(8,4) NOT NULL DEFAULT 0,  -- e.g. 2.0000 means 2 %
  fixed_amount   NUMERIC(12,4) NOT NULL DEFAULT 0,  -- per unit sold
  hybrid_mode    TEXT CHECK (hybrid_mode IN ('max', 'min', 'sum')),
  -- Scope: which sales this rule applies to
  scope          TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'vendor', 'product', 'category')),
  scope_id       TEXT,  -- vendor UUID | product UUID | category name string (NULL for global)
  effective_from DATE,
  effective_to   DATE,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  priority       INTEGER NOT NULL DEFAULT 0,  -- higher wins within same scope tier
  created_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dev_fee_configs_scope   ON public.developer_fee_configs(scope) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_dev_fee_configs_scope_id ON public.developer_fee_configs(scope_id) WHERE is_active = true AND scope_id IS NOT NULL;

-- ─── 4. Add developer_fee column to sales ────────────────────────────────────
-- Zero for all historical rows (backward-compatible).
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS developer_fee NUMERIC(14,4) NOT NULL DEFAULT 0;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS fee_config_id UUID REFERENCES public.developer_fee_configs(id) ON DELETE SET NULL;

-- ─── 5. Reconciliation runs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_type               TEXT NOT NULL CHECK (period_type IN ('daily', 'monthly', 'custom')),
  period_start              DATE NOT NULL,
  period_end                DATE NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('balanced', 'warning', 'mismatch', 'pending')),
  -- Revenue breakdown
  total_sales_revenue       NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_vendor_due          NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_developer_revenue   NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_distrogh_revenue    NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Adjustments
  total_returns_value       NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_deductions          NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_payouts_completed   NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_transport_charges   NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Variance
  expected_vendor_payable   NUMERIC(14,2) NOT NULL DEFAULT 0,
  actual_vendor_balance_sum NUMERIC(14,2) NOT NULL DEFAULT 0,
  variance                  NUMERIC(14,2) NOT NULL DEFAULT 0,
  variance_pct              NUMERIC(8,4) NOT NULL DEFAULT 0,
  notes                     TEXT,
  created_by                UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recon_runs_period     ON public.reconciliation_runs(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_recon_runs_status     ON public.reconciliation_runs(status);
CREATE INDEX IF NOT EXISTS idx_recon_runs_created_at ON public.reconciliation_runs(created_at DESC);

-- ─── 6. System configuration key-value store ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.system_config (
  key          TEXT PRIMARY KEY,
  value        TEXT,
  value_type   TEXT NOT NULL DEFAULT 'string'
                 CHECK (value_type IN ('string', 'number', 'boolean', 'json')),
  description  TEXT,
  category     TEXT NOT NULL DEFAULT 'general',
  is_sensitive BOOLEAN NOT NULL DEFAULT false,
  updated_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.system_config (key, value, value_type, description, category) VALUES
  ('platform.name',                  'DistroGH',        'string',  'Platform display name',                               'branding'),
  ('platform.version',               '1.0.0',           'string',  'Current platform version',                            'system'),
  ('developer.fee.enabled',          'false',           'boolean', 'Enable developer fee deductions on new sales imports', 'finance'),
  ('reconciliation.auto_run',        'false',           'boolean', 'Run daily reconciliation automatically',              'finance'),
  ('reconciliation.variance_threshold', '0.01',         'number',  'GHS variance amount that triggers a warning',         'finance'),
  ('security.max_failed_logins',     '5',               'number',  'Failed logins before audit alert is raised',          'security'),
  ('security.session_timeout_days',  '7',               'number',  'JWT session lifetime in days',                        'security'),
  ('sales.import.strict_pricing',    'false',           'boolean', 'Reject sales import rows where price < vendor price',  'finance')
ON CONFLICT (key) DO NOTHING;

-- ─── 7. Enhanced audit_logs: ensure index on action for security queries ─────
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_module ON public.audit_logs(action, module);

-- ─── 8. Backfill developer permissions for existing developer profiles (if any) ─
-- (No-op on fresh install; safe to run multiple times.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.admin_profiles WHERE admin_role = 'developer') THEN
    INSERT INTO public.admin_user_permissions (user_id, module, action)
    SELECT ap.user_id, p.module, p.action
    FROM public.admin_profiles ap
    CROSS JOIN public.permissions p
    WHERE ap.admin_role = 'developer'
    ON CONFLICT (user_id, module, action) DO NOTHING;
  END IF;
END $$;
