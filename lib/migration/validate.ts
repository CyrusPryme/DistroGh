import type { Pool } from 'pg'
import type { MigrationEntityType } from '@/lib/migration/types'
import { normalizeMomoNetwork, momoNetworkWasNormalized } from '@/lib/migration/normalize'
import { normalizeSalesRowData, isSupermarketPaidMarker } from '@/lib/migration/sales-fields'
import { matchSupermarketByBranch } from '@/lib/supermarket-match'
import { validateVendorPhones } from '@/lib/migration/vendor-fields'
import { writeMigrationAudit } from '@/lib/migration/audit'
import { updateMigrationProject } from '@/lib/migration/projects'
import { migrationProgressForStage } from '@/lib/migration/lifecycle'
import { normalizeCategoryName } from '@/lib/migration/category'
import { resolveDeliveryDestination } from '@/lib/migration/delivery-destination'
import { toSqlDate, normalizeSaleMonthPeriod } from '@/lib/utils'

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Parses a historical date field flexibly (ISO date, "YYYY-MM" month key, or any Date-parseable
 *  string) without ever silently substituting "today" — returns null on anything unparseable so
 *  callers can raise MISSING_DATE/INVALID_DATE instead of importing a fabricated date. */
function parseDate(v: unknown): Date | null {
  const raw = str(v)
  if (!raw) return null
  const normalized = /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : raw
  const d = new Date(normalized)
  return Number.isNaN(d.getTime()) ? null : d
}

type Issue = { code: string; message: string }

/** Exported for unit testing — the pure per-row rules (required fields, date accuracy, sales
 *  monthly-period normalization). The FK/cross-entity checks that need production data live in
 *  validateMigrationStaging() below. */
export function validateRow(
  entity: MigrationEntityType,
  data: Record<string, unknown>
): { errors: Issue[]; warnings: Issue[]; normalized: Record<string, unknown> } {
  const errors: Issue[] = []
  const warnings: Issue[] = []
  const normalized = { ...data }

  const requireField = (key: string, label = key) => {
    if (!str(data[key])) errors.push({ code: 'MISSING_FIELD', message: `${label} is required` })
  }

  // A missing/unparseable historical date must never be silently defaulted to "today" at import
  // time (that's how the "MAIDEN PRODUCTS UPLOAD" phantom-date class of bug happens) — surface it
  // here as a hard error instead, before the row can ever become eligible for Start Import.
  const requireDate = (value: unknown, label: string) => {
    if (!str(value)) {
      errors.push({ code: 'MISSING_DATE', message: `${label} is required` })
    } else if (!parseDate(value)) {
      errors.push({ code: 'INVALID_DATE', message: `${label} is not a valid date` })
    }
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
      requireDate(data.received_date, 'received_date')
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
      requireDate(data.delivery_date, 'delivery_date')
      break
    }
    case 'sales': {
      const qty = num(data.qty ?? data.quantity)
      if (qty == null || qty <= 0) errors.push({ code: 'INVALID_QTY', message: 'qty must be > 0' })
      if (!str(data.description) && !str(data.product) && !str(data.product_name) && !str(data.code) && !str(data.barcode)) {
        errors.push({ code: 'MISSING_PRODUCT', message: 'product identifier is required' })
      }
      if (!str(data.store_name) && !str(data.branch) && !str(data.store)) {
        warnings.push({
          code: 'SALES_BRANCH_MISSING',
          message: 'store_name / branch not provided — supermarket must be corrected manually before import',
        })
      }
      const tcost = num(data.TCostEx ?? data.vendor_due)
      if (tcost != null) normalized.vendor_due = tcost
      if (typeof data.supermarket_paid === 'boolean') {
        normalized.supermarket_paid = data.supermarket_paid
      }
      const periodSource = str(data.week_start) || str(data.report_month)
      if (!periodSource) {
        const monthOnly = str(data.month ?? data.MONTH)
        if (monthOnly && !str(data.report_year ?? data.year)) {
          errors.push({
            code: 'MISSING_DATE',
            message: 'report_month is required — or supply MONTH plus report_year (e.g. JUNE + 2024)',
          })
        } else {
          // Never fall back to "today" for a historical sales period — that would silently
          // misfile the sale into whatever month the migration happens to run in.
          errors.push({ code: 'MISSING_DATE', message: 'week_start or report_month is required' })
        }
      } else if (!parseDate(data.week_start) && !parseDate(data.report_month)) {
        errors.push({ code: 'INVALID_DATE', message: 'week_start/report_month is not a valid date' })
      } else {
        // Sales are always reported and reconciled by full calendar month in this system —
        // snap to that month's bounds now (same helper the live day-to-day importer uses:
        // normalizeSaleMonthPeriod in lib/utils.ts) so the visible normalized_data matches what
        // will actually be written, and surface it when the source's own week_end disagreed.
        const period = normalizeSaleMonthPeriod(toSqlDate(periodSource))
        normalized.week_start = period.week_start
        normalized.week_end = period.week_end
        const givenEnd = str(data.week_end)
        if (givenEnd && parseDate(givenEnd) && toSqlDate(givenEnd) !== period.week_end) {
          warnings.push({
            code: 'SALES_PERIOD_ADJUSTED',
            message: `Period adjusted to full calendar month ${period.week_start} to ${period.week_end} (source gave week_end ${toSqlDate(givenEnd)})`,
          })
        }
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
      requireDate(data.return_date, 'return_date')
      break
    }
    case 'deductions': {
      requireField('vendor_name', 'Vendor name')
      const amt = num(data.amount ?? data.amount_paid)
      if (amt == null || amt < 0) errors.push({ code: 'INVALID_AMOUNT', message: 'amount must be >= 0' })
      requireDate(data.deduction_date, 'deduction_date')
      break
    }
    case 'payouts': {
      requireField('vendor_name', 'Vendor name')
      const amt = num(data.amount ?? data.amount_paid)
      if (amt == null || amt < 0) errors.push({ code: 'INVALID_AMOUNT', message: 'amount must be >= 0' })
      if (!str(data.payout_date) && !str(data.week_start)) {
        errors.push({ code: 'MISSING_DATE', message: 'payout_date or week_start is required' })
      } else if (!parseDate(data.payout_date) && !parseDate(data.week_start)) {
        errors.push({ code: 'INVALID_DATE', message: 'payout_date/week_start is not a valid date' })
      }
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

  const { rows: supermarketRows } = await pool.query(
    `SELECT id, name, branch, store_code FROM public.supermarkets WHERE deleted_at IS NULL`
  )
  const supermarkets = supermarketRows as Array<{
    id: string
    name: string
    branch: string | null
    store_code: string | null
  }>

  // Earliest known date per product this stock was ever received/delivered — lets a Deliveries
  // row be flagged if it's dated before that product was ever received (intakes), and a
  // Sales/Returns row be flagged if it's dated before that product was ever delivered anywhere.
  // Mirrors the operational chain intakes -> deliveries -> returns/sales in lib/migration/
  // entities.ts (ENTITY_DEPENDENCIES) at the row-date level instead of just the file-upload level.
  const { rows: prodIntakeDates } = await pool.query(
    `SELECT product_id, MIN(received_date) AS d FROM public.intakes GROUP BY product_id`
  )
  const earliestIntakeByProduct = new Map<string, Date>(
    (prodIntakeDates as Array<{ product_id: string; d: string }>).map((r) => [r.product_id, new Date(r.d)])
  )
  const { rows: prodDeliveryDates } = await pool.query(
    `SELECT dri.product_id, MIN(dr.delivery_date) AS d
     FROM public.delivery_run_items dri
     JOIN public.delivery_runs dr ON dr.id = dri.delivery_run_id
     GROUP BY dri.product_id`
  )
  const earliestDeliveryByProduct = new Map<string, Date>(
    (prodDeliveryDates as Array<{ product_id: string; d: string }>).map((r) => [r.product_id, new Date(r.d)])
  )
  const trackEarliest = (map: Map<string, Date>, key: string | undefined, date: Date | null) => {
    if (!key || !date) return
    const existing = map.get(key)
    if (!existing || date < existing) map.set(key, date)
  }
  // Fold in rows staged elsewhere in this same migration (e.g. a companion Intakes file uploaded
  // alongside this Deliveries file) — resolved against production products only; a product that's
  // itself brand-new in this migration has no id yet to key these maps by, so it's skipped (its
  // deliveries/sales simply won't get a misalignment check, rather than a false positive).
  for (const row of staging) {
    if (row.entity_type !== 'intakes' && row.entity_type !== 'deliveries') continue
    const data = { ...(row.raw_data as object), ...(row.corrections as object) } as Record<string, unknown>
    const barcode = str(data.barcode || data.code).toLowerCase()
    const pname = str(data.product_name || data.product).toLowerCase()
    const pid = (barcode && productByBarcode.get(barcode)) || (pname && productByName.get(pname))
    if (!pid) continue
    if (row.entity_type === 'intakes') {
      trackEarliest(earliestIntakeByProduct, pid, parseDate(data.received_date))
    } else {
      trackEarliest(earliestDeliveryByProduct, pid, parseDate(data.delivery_date))
    }
  }

  let errorCount = 0
  let warningCount = 0
  const seenKeys = new Map<string, string>()

  for (const row of staging) {
    const entity = row.entity_type as MigrationEntityType
    const raw = { ...(row.raw_data as object), ...(row.corrections as object) } as Record<string, unknown>
    const data = entity === 'sales' ? normalizeSalesRowData(raw) : raw
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
        if (entity === 'sales' && !resolved.vendor_id) {
          const fromProduct = (products as ProductRow[]).find((p) => p.id === pid)
          if (fromProduct?.vendor_id) {
            resolved.vendor_id = fromProduct.vendor_id
            infos.push({ code: 'VENDOR_FROM_PRODUCT', message: 'Vendor resolved from matched product' })
          }
        }
      } else if (pname || barcode) {
        warnings.push({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found in production (may be created from staging)' })
      }
    }

    // Chronological misalignment: a delivery can't precede the warehouse receipt that stock came
    // from, and a sale/return can't precede the delivery that put stock at a supermarket (see
    // ENTITY_DEPENDENCIES in lib/migration/entities.ts). Warning, not an error — some legitimately
    // messy historical data predates when a vendor/product's intake trail started being tracked.
    if (resolved.product_id && entity === 'deliveries') {
      const thisDate = parseDate(data.delivery_date)
      const earliest = earliestIntakeByProduct.get(resolved.product_id)
      if (thisDate && earliest && thisDate < earliest) {
        warnings.push({
          code: 'DELIVERY_BEFORE_RECEIVING',
          message: `Delivery dated ${str(data.delivery_date)} is before the earliest Receiving record for this product (${earliest.toISOString().slice(0, 10)}) — check the date.`,
        })
      }
    }
    if (resolved.product_id && (entity === 'sales' || entity === 'returns')) {
      const dateField = entity === 'sales' ? data.week_start || data.report_month : data.return_date
      const thisDate = parseDate(dateField)
      const earliest = earliestDeliveryByProduct.get(resolved.product_id)
      if (thisDate && earliest && thisDate < earliest) {
        warnings.push({
          code: entity === 'sales' ? 'SALE_BEFORE_DELIVERY' : 'RETURN_BEFORE_DELIVERY',
          message: `${entity === 'sales' ? 'Sale' : 'Return'} dated ${str(dateField)} is before the earliest Delivery record for this product (${earliest.toISOString().slice(0, 10)}) — check the date.`,
        })
      }
    }

    if (entity === 'sales' && !errors.length) {
      const branch = str(data.store_name || data.branch)
      const storeCode = str(data.store || data.store_code)
      const matchedSm = matchSupermarketByBranch(branch, storeCode, supermarkets)
      if (matchedSm) {
        resolved.supermarket_id = matchedSm.id
        infos.push({
          code: 'SUPERMARKET_MATCHED',
          message: `Supermarket matched: ${matchedSm.name}${matchedSm.branch ? ` — ${matchedSm.branch}` : ''}`,
        })
      } else if (branch || storeCode) {
        warnings.push({
          code: 'SUPERMARKET_NOT_FOUND',
          message: `No supermarket matched store_name "${branch || storeCode}" — correct in wizard before import`,
        })
      }
      if (typeof data.supermarket_paid === 'boolean') {
        if (data.supermarket_paid) {
          infos.push({
            code: 'SUPERMARKET_SETTLED',
            message: 'Supermarket paid DistroGH for this line — counts toward vendor balance',
          })
        } else {
          infos.push({
            code: 'SUPERMARKET_UNSETTLED',
            message: 'Sold but supermarket has not paid DistroGH yet — excluded from vendor balance until settled',
          })
        }
      } else if (isSupermarketPaidMarker(data.paid ?? data.PAID)) {
        normalized.supermarket_paid = true
        infos.push({
          code: 'SUPERMARKET_SETTLED',
          message: 'PAID marked — supermarket settled this line with DistroGH',
        })
      } else if (data.PAID != null || data.paid != null) {
        normalized.supermarket_paid = false
        infos.push({
          code: 'SUPERMARKET_UNSETTLED',
          message: 'PAID blank — sold but not yet settled by supermarket',
        })
      } else {
        infos.push({
          code: 'SUPERMARKET_UNSETTLED',
          message: 'No PAID column — imports as awaiting supermarket payment; mark settled on Sales after DistroGH is paid',
        })
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
  const nextStage = errorCount > 0 ? 5 : 6

  await updateMigrationProject(
    pool,
    migrationId,
    {
      validation_status,
      status,
      error_count: errorCount,
      warning_count: warningCount,
      current_stage: nextStage,
      progress_pct: migrationProgressForStage(nextStage, status),
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
