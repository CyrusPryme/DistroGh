/**
 * Seed script: create the initial SUPER ADMIN account.
 *
 * Usage:
 *   node -r dotenv/config scripts/seed-super-admin.mjs dotenv_config_path=.env.local
 *
 * Environment variables (or .env.local):
 *   DATABASE_URL       — PostgreSQL connection string
 *   SUPER_ADMIN_EMAIL  — email for the super admin (default: superadmin@distrogh.com)
 *   SUPER_ADMIN_PASS   — password (required, min 8 chars)
 *   SUPER_ADMIN_FNAME  — first name (default: Super)
 *   SUPER_ADMIN_LNAME  — last name (default: Admin)
 */

import pg from 'pg'
import bcrypt from 'bcryptjs'

const { Pool } = pg

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/consignment'

const EMAIL  = (process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@distrogh.com').toLowerCase().trim()
const PASS   = process.env.SUPER_ADMIN_PASS ?? ''
const FNAME  = process.env.SUPER_ADMIN_FNAME ?? 'Super'
const LNAME  = process.env.SUPER_ADMIN_LNAME ?? 'Admin'

if (!PASS || PASS.length < 8) {
  console.error('❌  Set SUPER_ADMIN_PASS (min 8 characters) in your environment or .env.local')
  process.exit(1)
}

const pool = new Pool({ connectionString: DATABASE_URL })

async function run() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Check if email already exists
    const { rows: existing } = await client.query(
      `SELECT u.id, ap.admin_role
       FROM public.users u
       LEFT JOIN public.admin_profiles ap ON ap.user_id = u.id
       WHERE lower(u.email) = $1`,
      [EMAIL]
    )

    if (existing.length > 0) {
      const row = existing[0]
      if (row.admin_role === 'super_admin') {
        console.log(`ℹ️  Super admin already exists: ${EMAIL}`)
        await client.query('ROLLBACK')
        return
      }
      // Upgrade existing user
      const hash = await bcrypt.hash(PASS, 12)
      await client.query(`UPDATE public.users SET password_hash = $1 WHERE id = $2`, [hash, row.id])
      await client.query(
        `INSERT INTO public.admin_profiles (user_id, first_name, last_name, admin_role, status)
         VALUES ($1,$2,$3,'super_admin','active')
         ON CONFLICT (user_id) DO UPDATE
           SET admin_role = 'super_admin', status = 'active', first_name = $2, last_name = $3`,
        [row.id, FNAME, LNAME]
      )
      await client.query(
        `INSERT INTO public.profiles (user_id, role)
         VALUES ($1, 'admin')
         ON CONFLICT (user_id) DO UPDATE SET role = 'admin'`,
        [row.id]
      )
      console.log(`✅  Upgraded existing user to super_admin: ${EMAIL}`)
    } else {
      // Create new user
      const hash = await bcrypt.hash(PASS, 12)
      const { rows: [user] } = await client.query(
        `INSERT INTO public.users (email, password_hash) VALUES ($1,$2) RETURNING id`,
        [EMAIL, hash]
      )

      await client.query(
        `INSERT INTO public.profiles (user_id, role) VALUES ($1,'admin')`,
        [user.id]
      )

      await client.query(
        `INSERT INTO public.admin_profiles (user_id, first_name, last_name, admin_role, status)
         VALUES ($1,$2,$3,'super_admin','active')`,
        [user.id, FNAME, LNAME]
      )

      console.log(`✅  Super admin created: ${EMAIL}`)
    }

    await client.query('COMMIT')
    console.log('🔐  Login with:')
    console.log(`    Email:    ${EMAIL}`)
    console.log(`    Password: ${PASS}`)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch((e) => {
  console.error('❌ Seed failed:', e.message)
  process.exit(1)
})
