/**
 * Seed script: create the initial DEVELOPER account.
 *
 * Usage:
 *   node -r dotenv/config scripts/seed-developer.mjs dotenv_config_path=.env.local
 *
 * Environment variables (or .env.local):
 *   DATABASE_URL        — PostgreSQL connection string
 *   DEVELOPER_EMAIL     — email (default: developer@distrogh.com)
 *   DEVELOPER_PASS      — password (required, min 8 chars)
 *   DEVELOPER_FNAME     — first name (default: Platform)
 *   DEVELOPER_LNAME     — last name (default: Developer)
 */

import pg from 'pg'
import bcrypt from 'bcryptjs'

const { Pool } = pg

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/consignment'

const EMAIL = (process.env.DEVELOPER_EMAIL ?? 'developer@distrogh.com').toLowerCase().trim()
const PASS  = process.env.DEVELOPER_PASS ?? ''
const FNAME = process.env.DEVELOPER_FNAME ?? 'Platform'
const LNAME = process.env.DEVELOPER_LNAME ?? 'Developer'

if (!PASS || PASS.length < 8) {
  console.error('❌  Set DEVELOPER_PASS (min 8 characters) in your environment or .env.local')
  process.exit(1)
}

const pool = new Pool({ connectionString: DATABASE_URL })

async function run() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: existing } = await client.query(
      `SELECT u.id, ap.admin_role
       FROM public.users u
       LEFT JOIN public.admin_profiles ap ON ap.user_id = u.id
       WHERE lower(u.email) = $1`,
      [EMAIL]
    )

    if (existing.length > 0) {
      const row = existing[0]
      if (row.admin_role === 'developer') {
        console.log(`ℹ️  Developer account already exists: ${EMAIL}`)
        await client.query('ROLLBACK')
        return
      }
      // Upgrade existing user to developer
      const hash = await bcrypt.hash(PASS, 12)
      await client.query(`UPDATE public.users SET password_hash = $1 WHERE id = $2`, [hash, row.id])
      await client.query(
        `INSERT INTO public.admin_profiles (user_id, first_name, last_name, admin_role, status)
         VALUES ($1,$2,$3,'developer','active')
         ON CONFLICT (user_id) DO UPDATE
           SET admin_role = 'developer', status = 'active', first_name = $2, last_name = $3`,
        [row.id, FNAME, LNAME]
      )
      await client.query(
        `INSERT INTO public.profiles (user_id, role)
         VALUES ($1, 'admin')
         ON CONFLICT (user_id) DO UPDATE SET role = 'admin'`,
        [row.id]
      )
      console.log(`✅  Upgraded existing user to developer: ${EMAIL}`)
    } else {
      const hash = await bcrypt.hash(PASS, 12)
      const { rows: [user] } = await client.query(
        `INSERT INTO public.users (email, password_hash) VALUES ($1,$2) RETURNING id`,
        [EMAIL, hash]
      )
      await client.query(`INSERT INTO public.profiles (user_id, role) VALUES ($1,'admin')`, [user.id])
      await client.query(
        `INSERT INTO public.admin_profiles (user_id, first_name, last_name, admin_role, status)
         VALUES ($1,$2,$3,'developer','active')`,
        [user.id, FNAME, LNAME]
      )
      console.log(`✅  Developer account created: ${EMAIL}`)
    }

    await client.query('COMMIT')
    console.log('🔐  Login with:')
    console.log(`    Email:    ${EMAIL}`)
    console.log(`    Password: ${PASS}`)
    console.log('')
    console.log('👑  This account has unrestricted access to all platform modules.')
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
