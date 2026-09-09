/**
 * Generate payouts migration template with live vendor dropdown.
 * Usage: npx tsx -r dotenv/config scripts/generate-payouts-template.ts dotenv_config_path=.env.local
 */
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import pg from 'pg'
import { buildMigrationTemplateWorkbook } from '@/lib/migration/template-xlsx'
import { fetchMigrationTemplateBuildOptions } from '@/lib/migration/template-build-options'
import type { MigrationTemplateRecord } from '@/lib/migration/types'

const OUT_DIR = resolve(process.cwd(), 'payouts migration')
const OUT_FILE = resolve(OUT_DIR, 'payouts-TEMPLATE.xlsx')

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const { rows } = await pool.query(`SELECT * FROM migration_templates WHERE entity_type = 'payouts'`)
  if (!rows[0]) throw new Error('payouts migration template not found in DB')
  const template = rows[0] as MigrationTemplateRecord
  const options = await fetchMigrationTemplateBuildOptions(pool)
  await pool.end()

  const buffer = await buildMigrationTemplateWorkbook(template, options)
  mkdirSync(dirname(OUT_FILE), { recursive: true })
  writeFileSync(OUT_FILE, buffer)
  console.log('Wrote:', OUT_FILE)
  console.log('Vendors in dropdown:', options.vendorNames?.length ?? 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
