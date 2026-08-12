import type { Pool } from 'pg'
import type { MigrationEntityType } from '@/lib/migration/types'
import { normalizeMomoNetwork, momoNetworkWasNormalized } from '@/lib/migration/normalize'
import { validateVendorPhones } from '@/lib/migration/vendor-fields'
import { writeMigrationAudit } from '@/lib/migration/audit'
import { updateMigrationProject } from '@/lib/migration/projects'
import { normalizeCategoryName } from '@/lib/migration/category'
import { resolveDeliveryDestination } from '@/lib/migration/delivery-destination'

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
    case 'vendors': {
      requireField('name', 'Vendor name')
      normalized.access_mode = 'admin_managed'
      const phoneResult = validateVendorPhones({ ...data, ...normalized })
      Object.assign(normalized, phoneResult.normalized)
      errors.push(...phoneResult.errors)
      warnings.push(...phoneResult.warnings)
      normalized.momo_network = normalizeMomoNetwork(normalized.momo_network ?? data.momo_network)
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
    }
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
      // Branch/supermarket is NOT a required unique business destination for historical
      // deliveries redistributed from a central warehouse — destination is resolved
      // (BRANCH / WAREHOUSE / DISTRIBUTION_POINT / UNKNOWN_HISTORICAL) in the outer
      // validateMigrationStaging pass, where production data is available to match against.
      if (!str(data.product_name) && !str(data.product) && !str(data.barcode)) {
        errors.push({ code: 'MISSING_PRODUCT', message: 'product_name or barcode is required' })
      }
      const q = num(data.quantity ?? data.qty)
      if (q == null || q <= 0) errors.push({ code: 'INVALID_QTY', message: 'quantity must be > 0' })
      const delDate = str(data.delivery_date)
      if (delDate && Number.isNaN(new Date(delDate).getTime())) {
        errors.push({ code: 'INVALID_DATE', message: 'delivery_date is not a valid date' })
      }
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

  // Vendors staged for creation *within this same migration* (e.g. a companion vendors.xlsx)
  // will exist in production by the time a dependent entity's import runs, since import_order
  // always processes 'vendors' first. A vendor_name that matches neither production nor this
  // set will NEVER resolve — the writers for products/intakes/deductions/payouts/service_charges/
  // vendor_documents look up an existing vendor by name and throw if none is found; none of them
  // create one. Distinguishing these two cases lets a genuinely-unresolvable vendor_name become a
  // hard error at validation time instead of a "may be created from staging" warning that turns
  // into an import-time failure discovered only after Start Import (and, since import runs each
  // entity's chunk as a single transaction, can also roll back every otherwise-valid row in it).
  const { rows: stagedVendorRows } = await pool.query(
    `SELECT raw_data, corrections FROM public.migration_staging_rows WHERE migration_id = $1 AND entity_type = 'vendors'`,
    [migrationId]
  )
  const vendorNamesStagedThisMigration = new Set(
    stagedVendorRows
      .map((r: { raw_data: unknown; corrections: unknown }) => {
        const merged = { ...(r.raw_data as Record<string, unknown>), ...(r.corrections as Record<string, unknown>) }
        return str(merged.name).toLowerCase()
      })
      .filter((name: string) => name.length > 0)
  )
  // Entities whose writer requires an existing vendor_id and has no fallback to create one.
  const ENTITIES_REQUIRING_RESOLVABLE_VENDOR = new Set<MigrationEntityType>([
    'products',
    'intakes',
    'deductions',
    'payouts',
    'service_charges',
    'vendor_documents',
  ])

  const { rows: products } = await pool.query(
    `SELECT id, vendor_id, category, lower(trim(name)) AS name, lower(trim(coalesce(barcode,''))) AS barcode
     FROM public.products WHERE deleted_at IS NULL`
  )
  const productByName = new Map(products.map((p: { id: string; name: string }) => [p.name, p.id]))
  const productByBarcode = new Map(
    products.filter((p: { barcode: string }) => p.barcode).map((p: { id: string; barcode: string }) => [p.barcode, p.id])
  )
  type ProductRow = { id: string; vendor_id: string; category: string | null; name: string; barcode: string }
  const productByBarcodeFull = new Map((products as ProductRow[]).filter((p) => p.barcode).map((p) => [p.barcode, p]))
  const productByVendorAndName = new Map(
    (products as ProductRow[]).map((p) => [`${p.vendor_id}::${p.name}`, p])
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
    const infos: Issue[] = []

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
        infos.push({ code: 'VENDOR_MATCHED', message: `Existing vendor matched: "${vn}"` })
      } else if (vn && vendorNamesStagedThisMigration.has(vn)) {
        // Genuinely recoverable: this migration also stages a vendor row with this exact name,
        // and 'vendors' always imports before this entity (import_order is dependency-sorted), so
        // resolved_refs.vendor_id will be set for real by the time this row's writer runs.
        warnings.push({ code: 'VENDOR_NOT_FOUND', message: `Vendor "${vn}" not found in production yet — will be created from this migration's own vendors upload` })
      } else if (vn && entity !== 'sales' && !ENTITIES_REQUIRING_RESOLVABLE_VENDOR.has(entity)) {
        warnings.push({ code: 'VENDOR_NOT_FOUND', message: `Vendor "${vn}" not found in production (may be created from staging)` })
      } else if (vn && ENTITIES_REQUIRING_RESOLVABLE_VENDOR.has(entity)) {
        // This is not recoverable: these writers only look up an existing vendor by name and
        // throw if none is found — there is no create-on-import fallback. Surfacing this as a
        // hard error here (Corrections stage) instead of a soft warning is what stops it from
        // reaching Start Import and rolling back an entire otherwise-valid chunk.
        errors.push({
          code: 'VENDOR_UNRESOLVABLE',
          message: `Vendor "${vn}" does not exist in production and is not included as a vendor row in this migration — add/upload it first, or correct this row's vendor name`,
        })
      }
    }

    if (['intakes', 'sales', 'returns', 'deliveries'].includes(entity)) {
      const barcode = str(data.barcode || data.code).toLowerCase()
      const pname = str(data.product_name || data.product || data.description).toLowerCase()
      const pid = (barcode && productByBarcode.get(barcode)) || (pname && productByName.get(pname))
      if (pid) {
        resolved.product_id = pid
        infos.push({ code: 'PRODUCT_MATCHED', message: 'Existing product matched' })
      } else if (pname || barcode) {
        warnings.push({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found in production (may be created from staging)' })
      }
    }

    // Historical delivery destination + transport cost: never an ERROR unless the row is
    // otherwise unsafe (bad product/qty/date, handled in validateRow above).
    if (entity === 'deliveries' && !errors.length) {
      const destination = await resolveDeliveryDestination(pool, data)
      if (destination.supermarketId) resolved.supermarket_id = destination.supermarketId
      if (destination.destinationType === 'UNKNOWN_HISTORICAL') {
        warnings.push({
          code: 'DELIVERY_DESTINATION_UNKNOWN',
          message: 'No branch, warehouse, or distribution destination could be identified — accepted as an unknown historical destination.',
        })
      } else if (destination.destinationType !== 'BRANCH') {
        warnings.push({
          code: 'DELIVERY_BRANCH_NOT_PROVIDED',
          message: `Branch not provided — accepted as historical ${destination.destinationType === 'WAREHOUSE' ? 'warehouse' : 'distribution'} delivery (${destination.destinationReference ?? 'unnamed'}).`,
        })
      }
      const tc = data.transport_cost
      if (tc == null || str(tc) === '') {
        warnings.push({
          code: 'DELIVERY_TRANSPORT_COST_MISSING',
          message: 'Historical transport cost missing — will be recorded as "Not Recorded (Historical)", not zero.',
        })
      }
    }

    // Product category change detection — never silent, never lost.
    if (entity === 'products' && !errors.length) {
      const barcode = str(data.barcode).toLowerCase()
      const vendorId = resolved.vendor_id
      const name = str(data.name).toLowerCase()
      const existingProduct =
        (barcode && productByBarcodeFull.get(barcode)) ||
        (vendorId && name ? productByVendorAndName.get(`${vendorId}::${name}`) : undefined)
      const incomingCategory = str(data.category)
      if (existingProduct) {
        const existingCategory = existingProduct.category?.trim() || null
        if (!incomingCategory) {
          // Incoming missing -> existing category is preserved untouched (INFO, not a change).
          if (existingCategory) infos.push({ code: 'CATEGORY_PRESERVED', message: `Category preserved (${existingCategory}) — incoming row had no category` })
        } else if (existingCategory && normalizeCategoryName(existingCategory) === normalizeCategoryName(incomingCategory)) {
          infos.push({ code: 'CATEGORY_UNCHANGED', message: `Category unchanged (${existingCategory})` })
        } else if (!existingCategory) {
          warnings.push({ code: 'CATEGORY_POPULATED', message: `Category will be set to "${incomingCategory}" (previously not set)` })
        } else {
          warnings.push({
            code: 'CATEGORY_WILL_BE_OVERRIDDEN',
            message: `Category will be overwritten: "${existingCategory}" -> "${incomingCategory}" (Source: Historical Migration)`,
          })
        }
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
           infos = $9::jsonb,
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
        JSON.stringify(infos),
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
      last_validated_at: new Date().toISOString(),
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
