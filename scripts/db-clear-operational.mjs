/**
 * Wipe operational / mock data so the system can start with real data.
 * Preserves: RBAC, system config, admin/developer auth accounts, migration DDL history.
 *
 * Run: node -r dotenv/config scripts/db-clear-operational.mjs dotenv_config_path=.env.local
 */
import pg from 'pg'

const { Pool } = pg

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/consignment'

/** Demo / seed logins that should not remain after a clean start */
const DEMO_EMAILS = [
  'admin@example.com',
  'gorce@vendor.com',
  'akosua@vendor.com',
  'vendor@example.com',
]

const pool = new Pool({ connectionString: DATABASE_URL })

async function run() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    console.log('Clearing operational tables…')

    // Order matters for FKs; TRUNCATE CASCADE handles dependents where present.
    await client.query(`
      TRUNCATE TABLE
        public.delivery_run_vendor_charges,
        public.delivery_run_items,
        public.supermarket_inventory,
        public.sales,
        public.product_returns,
        public.intakes,
        public.delivery_runs,
        public.payouts,
        public.vendor_deductions,
        public.products,
        public.vendor_applications,
        public.vendor_deactivation_requests,
        public.reconciliation_runs,
        public.migration_audit_events,
        public.migration_rollback_log,
        public.migration_phase_results,
        public.migration_jobs,
        public.migration_entity_mappings,
        public.migration_staging_rows,
        public.migration_file_blobs,
        public.migration_files,
        public.migration_projects,
        public.vendors,
        public.supermarkets
      RESTART IDENTITY CASCADE
    `)

    // Detach any leftover vendor profile links
    await client.query(`UPDATE public.profiles SET vendor_id = NULL WHERE vendor_id IS NOT NULL`)

    // Remove demo vendor/user seed accounts (keep real admin/developer accounts)
    const { rows: demoUsers } = await client.query(
      `SELECT id, email FROM public.users WHERE lower(email) = ANY($1::text[])`,
      [DEMO_EMAILS.map((e) => e.toLowerCase())]
    )

    if (demoUsers.length) {
      const ids = demoUsers.map((u) => u.id)
      console.log(
        'Removing demo users:',
        demoUsers.map((u) => u.email).join(', ')
      )
      await client.query(`DELETE FROM public.admin_user_permissions WHERE user_id = ANY($1::uuid[])`, [ids])
      await client.query(`DELETE FROM public.admin_profiles WHERE user_id = ANY($1::uuid[])`, [ids])
      await client.query(`DELETE FROM public.profiles WHERE user_id = ANY($1::uuid[])`, [ids])
      await client.query(`DELETE FROM public.users WHERE id = ANY($1::uuid[])`, [ids])
    }

    // Keep useful default categories; remove nothing critical
    // Optional: reset categories to the four defaults only
    await client.query(`DELETE FROM public.categories`)
    await client.query(`
      INSERT INTO public.categories (name, sort_order) VALUES
        ('Beverages', 1),
        ('Snacks', 2),
        ('Personal Care', 3),
        ('Household', 4)
      ON CONFLICT DO NOTHING
    `)

    await client.query('COMMIT')

    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM public.vendors) AS vendors,
        (SELECT COUNT(*) FROM public.products) AS products,
        (SELECT COUNT(*) FROM public.sales) AS sales,
        (SELECT COUNT(*) FROM public.supermarkets) AS supermarkets,
        (SELECT COUNT(*) FROM public.users) AS users
    `)
    console.log('Clean slate counts:', counts.rows[0])
    console.log('Done. Admin/developer accounts preserved. Ready for real data.')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('Clear failed:', e.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

run()
