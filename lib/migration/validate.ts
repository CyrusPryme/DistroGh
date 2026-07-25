import type { Pool } from 'pg'
import type { MigrationEntityType } from '@/lib/migration/types'
import { normalizeMomoNetwork, momoNetworkWasNormalized } from '@/lib/migration/normalize'
import { writeMigrationAudit } from '@/lib/migration/audit'
import { updateMigrationProject } from '@/lib/migration/projects'

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

type Issue = { code: string; message: string }

function validateRow(
  entity: MigrationEntityType,
  data: Record<string, unknown>
): { errors: Issue[]; warnings: Issue[]; normalized: Record<string, unknown> } {
  const errors: Issue[] = []
  const warnings: Issue[] = []
  const normalized = { ...data }

  const requireField = (key: string, label = key) => {
    if (!str(data[key])) errors.push({ code: 'MISSING_FIELD', message: `${label} is required` })
  }

  switch (entity) {
    case 'categories':
      requireField('name', 'Category name')
      break
    case 'vendors':
      requireField('name', 'Vendor name')
      // Historical migrations always import as admin-managed (no portal login)
      normalized.access_mode = 'admin_managed'
      normalized.momo_network = normalizeMomoNetwork(data.momo_network)
      if (momoNetworkWasNormalized(data.momo_network)) {
        warnings.push({
          code: 'MOMO_NETWORK_NORMALIZED',
          message: `momo_network "${str(data.momo_network)}" will be imported as ${normalized.momo_network}`,
        })
      }
      if (str(data.login_email) || str(data.email)) {
        warnings.push({
          code: 'ADMIN_MANAGED_NO_LOGIN',
          message: 'Login email ignored — migrated vendors are admin-managed (reports only)',
        })
      }
      break
    case 'products': {
      requireField('name', 'Product name')
      if (!str(data.vendor_name) && !str(data.vendor)) {
        errors.push({ code: 'MISSING_VENDOR', message: 'vendor_name is required' })
      }
      const price = num(data.vendor_price)
      if (price == null) errors.push({ code: 'MISSING_PRICE', message: 'vendor_price is required' })
      else if (price < 0) errors.push({ code: 'NEGATIVE_PRICE', message: 'vendor_price cannot be negative' })
      break
    }
    case 'supermarkets':
      requireField('name', 'Supermarket / chain name')
      break
    case 'intakes': {
      if (!str(data.vendor_name) && !str(data.vendor)) {
        errors.push({ code: 'MISSING_VENDOR', message: 'vendor_name is required' })
      }
      if (!str(data.product_name) && !str(data.product) && !str(data.barcode)) {
        errors.push({ code: 'MISSING_PRODUCT', message: 'product_name or barcode is required' })
      }
      const q = num(data.quantity ?? data.qty)
      if (q == null || q <= 0) errors.push({ code: 'INVALID_QTY', message: 'quantity must be > 0' })
      else normalized.quantity = q
      break
    }
    case 'deliveries': {
      if (!str(data.supermarket_name) && !str(data.name) && !str(data.store)) {
        errors.push({ code: 'MISSING_SUPERMARKET', message: 'supermarket_name is required' })
      }
      if (!str(data.product_name) && !str(data.product) && !str(data.barcode)) {
        errors.push({ code: 'MISSING_PRODUCT', message: 'product_name or barcode is required' })
      }
      const q = num(data.quantity ?? data.qty)
      if (q == null || q <= 0) errors.push({ code: 'INVALID_QTY', message: 'quantity must be > 0' })
      break
    }
    case 'sales': {
      const qty = num(data.qty ?? data.quantity)
      if (qty == null || qty <= 0) errors.push({ code: 'INVALID_QTY', message: 'qty must be > 0' })
      if (!str(data.description) && !str(data.product) && !str(data.product_name) && !str(data.code) && !str(data.barcode)) {
        errors.push({ code: 'MISSING_PRODUCT', message: 'product identifier is required' })
      }
      break
    }
    case 'returns': {
      const q = num(data.quantity ?? data.qty)
      if (q == null || q <= 0) errors.push({ code: 'INVALID_QTY', message: 'quantity must be > 0' })
      if (!str(data.product_name) && !str(data.product) && !str(data.barcode)) {
        errors.push({ code: 'MISSING_PRODUCT', message: 'product_name is required' })
      }
      if (!str(data.reason)) warnings.push({ code: 'MISSING_REASON', message: 'reason missing; default other' })
      break
    }
    case 'deductions':
    case 'payouts': {
      requireField('vendor_name', 'Vendor name')
      const amt = num(data.amount ?? data.amount_paid)
      if (amt == null || amt < 0) errors.push({ code: 'INVALID_AMOUNT', message: 'amount must be >= 0' })
      break
    }
    case 'opening_balances': {
      requireField('vendor_name', 'Vendor name')
      const bal = num(data.balance)
      if (bal == null) errors.push({ code: 'MISSING_BALANCE', message: 'balance is required' })
      warnings.push({
        code: 'OPENING_BALANCE_POLICY',
        message: 'Opening balances commit only after explicit approval policy (staging only until then)',
      })
      break
    }
    default:
      break
  }

  return { errors, warnings, normalized }
}

/**
 * Validate all staging rows for a migration. Also soft-checks FK existence against production.
 */
export async function validateMigrationStaging(
  pool: Pool,
  migrationId: string,
  actorId?: string | null
) {
  await updateMigrationProject(pool, migrationId, { validation_status: 'running', status: 'analysing' }, actorId)

  const { rows: vendors } = await pool.query(
    `SELECT id, lower(trim(name)) AS name FROM public.vendors WHERE deleted_at IS NULL`
  )
  const vendorByName = new Map(vendors.map((v: { id: string; name: string }) => [v.name, v.id]))

  const { rows: products } = await pool.query(
    `SELECT id, lower(trim(name)) AS name, lower(trim(coalesce(barcode,''))) AS barcode
     FROM public.products WHERE deleted_at IS NULL`
  )
  const productByName = new Map(products.map((p: { id: string; name: string }) => [p.name, p.id]))
  const productByBarcode = new Map(
    products.filter((p: { barcode: string }) => p.barcode).map((p: { id: string; barcode: string }) => [p.barcode, p.id])
  )

  const { rows: staging } = await pool.query(
    `SELECT id, entity_type, raw_data, corrections
     FROM public.migration_staging_rows WHERE migration_id = $1`,
    [migrationId]
  )

  let errorCount = 0
  let warningCount = 0
  const seenKeys = new Map<string, string>()

  for (const row of staging) {
    const entity = row.entity_type as MigrationEntityType
    const data = { ...(row.raw_data as object), ...(row.corrections as object) } as Record<string, unknown>
    const { errors, warnings, normalized } = validateRow(entity, data)

    // Duplicate detection within file/entity
    const dupKey = (() => {
      if (entity === 'vendors') return `vendors:${str(data.name).toLowerCase()}`
      if (entity === 'products') return `products:${str(data.barcode || data.name).toLowerCase()}`
      if (entity === 'categories') return `categories:${str(data.name).toLowerCase()}`
      return null
    })()
    if (dupKey) {
      if (seenKeys.has(dupKey)) {
        errors.push({ code: 'DUPLICATE_ROW', message: `Duplicate ${entity} key in upload` })
      } else {
        seenKeys.set(dupKey, row.id)
      }
    }

    // Soft FK suggestions
    const suggestions: Array<{ id: string; label: string; confidence: number }> = []
    const resolved: Record<string, string> = {}

    if (['products', 'intakes', 'sales', 'returns', 'deliveries', 'deductions', 'payouts', 'service_charges', 'opening_balances', 'vendor_documents'].includes(entity)) {
      const vn = str(data.vendor_name || data.vendor || data.NAME || data.name).toLowerCase()
      if (entity === 'vendors') {
        const id = vendorByName.get(str(data.name).toLowerCase())
        if (id) {
          resolved.vendor_id = id
          suggestions.push({ id, label: str(data.name), confidence: 100 })
        }
      } else if (vn && vendorByName.has(vn)) {
        resolved.vendor_id = vendorByName.get(vn)!
      } else if (vn && entity !== 'sales') {
        warnings.push({ code: 'VENDOR_NOT_FOUND', message: `Vendor "${vn}" not found in production (may be created from staging)` })
      }
    }

    if (['intakes', 'sales', 'returns', 'deliveries'].includes(entity)) {
      const barcode = str(data.barcode || data.code).toLowerCase()
      const pname = str(data.product_name || data.product || data.description).toLowerCase()
      const pid = (barcode && productByBarcode.get(barcode)) || (pname && productByName.get(pname))
      if (pid) resolved.product_id = pid
      else if (pname || barcode) {
        warnings.push({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found in production (may be created from staging)' })
      }
    }

    const status = errors.length ? 'error' : warnings.length ? 'warning' : 'valid'
    if (errors.length) errorCount++
    if (warnings.length) warningCount++

    await pool.query(
      `UPDATE public.migration_staging_rows
       SET normalized_data = $2::jsonb,
           validation_status = $3,
           errors = $4::jsonb,
           warnings = $5::jsonb,
           match_suggestions = $6::jsonb,
           resolved_refs = $7::jsonb,
           intended_action = CASE WHEN $8::uuid IS NOT NULL THEN 'update' ELSE 'create' END,
           updated_at = now()
       WHERE id = $1`,
      [
        row.id,
        JSON.stringify(normalized),
        status,
        JSON.stringify(errors),
        JSON.stringify(warnings),
        JSON.stringify(suggestions),
        JSON.stringify(resolved),
        resolved.vendor_id || resolved.product_id || null,
      ]
    )
  }

  const validation_status = errorCount > 0 ? 'failed' : warningCount > 0 ? 'warnings' : 'passed'
  const status = errorCount > 0 ? 'awaiting_correction' : 'ready'

  await updateMigrationProject(
    pool,
    migrationId,
    {
      validation_status,
      status,
      error_count: errorCount,
      warning_count: warningCount,
      current_stage: errorCount > 0 ? 5 : 6,
      wizard_state: { stage: errorCount > 0 ? 5 : 6, validated_at: new Date().toISOString() },
      error_summary: { error_rows: errorCount },
      warning_summary: { warning_rows: warningCount },
    },
    actorId,
    'migration.validated'
  )

  await writeMigrationAudit(pool, {
    migrationId,
    actorId,
    action: 'migration.validated',
    stage: 4,
    details: { errorCount, warningCount, validation_status },
  })

  return { errorCount, warningCount, validation_status }
}
